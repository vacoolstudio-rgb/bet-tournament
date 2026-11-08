import type { ConfirmChannel } from 'amqplib';
import { drain, HEADER_REPLAYED_AT, headersFor, routingKeyFor } from '../../../tools/replay.js';
import {
  HEADER_PARK_ATTEMPTS,
  HEADER_PARK_REASON,
  HEADER_PARK_ROUTING_KEY,
  HEADER_X_DEATH,
  ROUTING_KEY_ROLLBACK,
  ROUTING_KEY_SETTLED,
} from '../../../src/messaging/topology.js';

const parked = (headers: Record<string, unknown>) => ({ headers, body: '{}' });

describe('routingKeyFor', () => {
  it.each([ROUTING_KEY_SETTLED, ROUTING_KEY_ROLLBACK])('returns the stored key %s', (key) => {
    expect(routingKeyFor(parked({ [HEADER_PARK_ROUTING_KEY]: key }))).toBe(key);
  });

  it.each([
    ['a key the service does not handle', { [HEADER_PARK_ROUTING_KEY]: 'bet.cashout' }],
    ['the queue name a direct send would leave', { [HEADER_PARK_ROUTING_KEY]: 'tournament.bets' }],
    ['no header at all', {}],
    ['a non-string header', { [HEADER_PARK_ROUTING_KEY]: 42 }],
  ])('refuses %s rather than guessing', (_case, headers) => {
    // Replaying under a guessed key would deliver a settle to the rollback
    // path or drop the message into an unbound exchange. Left in the parking
    // queue, it is still a human's decision.
    expect(routingKeyFor(parked(headers))).toBeUndefined();
  });
});

describe('headersFor', () => {
  it('drops x-death, so a replayed message starts its attempts from one', () => {
    // The attempt counter is derived from x-death. Carried over, a message
    // that had used four attempts would be parked again on its first failure,
    // which is the opposite of what replaying it was for.
    const headers = headersFor(
      parked({ [HEADER_X_DEATH]: [{ queue: 'tournament.bets', count: 4 }] }),
    );

    expect(headers[HEADER_X_DEATH]).toBeUndefined();
  });

  it('drops the park headers, which describe a failure that was fixed', () => {
    const headers = headersFor(
      parked({
        [HEADER_PARK_REASON]: 'unknown_currency',
        [HEADER_PARK_ATTEMPTS]: 1,
        [HEADER_PARK_ROUTING_KEY]: ROUTING_KEY_SETTLED,
      }),
    );

    expect(headers[HEADER_PARK_REASON]).toBeUndefined();
    expect(headers[HEADER_PARK_ATTEMPTS]).toBeUndefined();
    expect(headers[HEADER_PARK_ROUTING_KEY]).toBeUndefined();
  });

  it('keeps everything the producer put there', () => {
    const headers = headersFor(parked({ 'x-producer': 'settlement-service', trace: 'abc' }));

    expect(headers['x-producer']).toBe('settlement-service');
    expect(headers['trace']).toBe('abc');
  });

  it('stamps the replay, so a message that comes back twice says so', () => {
    expect(typeof headersFor(parked({}))[HEADER_REPLAYED_AT]).toBe('string');
  });
});

describe('drain', () => {
  /** A confirm channel that can be told to fail its confirms. */
  function fakeChannel(messages: number, confirmsFail = false) {
    const queue = Array.from({ length: messages }, (_, index) => ({
      content: Buffer.from(`{"n":${index}}`),
      properties: { headers: { [HEADER_PARK_ROUTING_KEY]: 'bet.settled' } },
      fields: { deliveryTag: index + 1 },
    }));
    const calls: string[] = [];

    return {
      calls,
      channel: {
        get: vi.fn(() => Promise.resolve(queue.shift() ?? false)),
        publish: vi.fn(() => {
          calls.push('publish');

          return true;
        }),
        waitForConfirms: vi.fn(() => {
          calls.push('confirm');

          return confirmsFail
            ? Promise.reject(new Error('broker refused the publish'))
            : Promise.resolve();
        }),
        ack: vi.fn(() => void calls.push('ack')),
        nackAll: vi.fn(() => void calls.push('nackAll')),
      },
    };
  }

  it('acknowledges the parked copy only after the broker confirms the new one', async () => {
    // The order is the safety: a message acknowledged before the publish is
    // confirmed has left the parking queue on the strength of a promise the
    // broker never made.
    const { channel, calls } = fakeChannel(2);

    await drain(channel as unknown as ConfirmChannel, { limit: 10, dryRun: false });

    expect(calls).toEqual(['publish', 'confirm', 'ack', 'publish', 'confirm', 'ack']);
  });

  it('never acknowledges a message the broker would not take', async () => {
    // Which is the situation the ordering exists for, and the one a healthy
    // broker never produces — so it is arranged here rather than hoped for.
    const { channel, calls } = fakeChannel(1, true);

    await expect(
      drain(channel as unknown as ConfirmChannel, { limit: 10, dryRun: false }),
    ).rejects.toThrow('broker refused the publish');

    expect(channel.ack).not.toHaveBeenCalled();
    expect(calls).toEqual(['publish', 'confirm']);
  });

  it('acknowledges nothing at all on a dry run', async () => {
    const { channel } = fakeChannel(3);

    const summary = await drain(channel as unknown as ConfirmChannel, {
      limit: 10,
      dryRun: true,
    });

    expect(summary).toEqual({ replayed: 3, skipped: 0 });
    expect(channel.publish).not.toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
    // Held while the queue was read, handed back in one step at the end.
    expect(channel.nackAll).toHaveBeenCalledWith(true);
  });
});
