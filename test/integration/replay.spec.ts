import { inject } from 'vitest';
import { HEADER_REPLAYED_AT, replay } from '../../tools/replay.js';
import {
  EXCHANGE_PARKED,
  HEADER_PARK_AT,
  HEADER_PARK_ATTEMPTS,
  HEADER_PARK_ERROR,
  HEADER_PARK_REASON,
  HEADER_PARK_ROUTING_KEY,
  HEADER_X_DEATH,
  QUEUE_BETS,
  QUEUE_PARKED,
  ROUTING_KEY_PARKED,
  ROUTING_KEY_SETTLED,
} from '../../src/messaging/topology.js';
import { resetBroker } from './support/app.js';
import type { Broker } from './support/broker.js';
import { settledEvent } from '../support/builders.js';

/**
 * Getting messages out of the parking queue, which is the half of the policy
 * that is easy to forget.
 *
 * Parking is only useful if there is a way back: a message is parked because it
 * could not succeed *yet* — a currency missing from the config, a producer bug
 * since fixed — and without a replay, "parked" and "lost" mean the same thing.
 * The pure parts of the tool were unit-tested; the drain itself, which is where
 * a message can actually be lost, was not. The order inside it is the whole
 * point: publish, wait for the broker to confirm its copy, and only then
 * acknowledge the one in parking. Acknowledge first and a broker that drops the
 * publish has eaten a settled bet.
 */
let broker: Broker;

beforeAll(async () => {
  broker = await resetBroker();
}, 120_000);

afterAll(async () => {
  await broker?.close();
});

beforeEach(async () => {
  await broker.purge(QUEUE_PARKED, QUEUE_BETS);
});

/** Parks a message the way `ParkingPublisher` does. */
function park(
  reason: string,
  overrides: Record<string, unknown> = {},
  // `null`, not `undefined`: passing `undefined` for a parameter with a
  // default uses the default, which is how the first version of this file
  // "proved" that an unroutable message gets replayed.
  routingKey: string | null = ROUTING_KEY_SETTLED,
): void {
  broker.publish(EXCHANGE_PARKED, ROUTING_KEY_PARKED, settledEvent(), {
    headers: {
      [HEADER_X_DEATH]: [{ queue: QUEUE_BETS, reason: 'rejected', count: 5 }],
      [HEADER_PARK_REASON]: reason,
      [HEADER_PARK_ERROR]: 'PoisonMessageError: nope',
      [HEADER_PARK_ATTEMPTS]: 5,
      [HEADER_PARK_AT]: new Date().toISOString(),
      ...(routingKey === null ? {} : { [HEADER_PARK_ROUTING_KEY]: routingKey }),
      ...overrides,
    },
  });
}

const drain = (dryRun: boolean, limit = 100) => replay({ url: inject('amqpUrl'), limit, dryRun });

describe('replaying parked messages', () => {
  it('puts them back on the main queue with the key they arrived with', async () => {
    park('unknown_currency');
    park('unknown_currency');
    await expect.poll(() => broker.depth(QUEUE_PARKED), { timeout: 10_000 }).toBe(2);

    const summary = await drain(false);

    expect(summary).toEqual({ replayed: 2, skipped: 0 });
    expect(await broker.depth(QUEUE_PARKED)).toBe(0);
    await expect.poll(() => broker.depth(QUEUE_BETS), { timeout: 10_000 }).toBe(2);

    const message = await broker.take(QUEUE_BETS);
    broker.ack(message);
    expect(message.fields.routingKey).toBe(ROUTING_KEY_SETTLED);
  });

  it('strips the record of the previous life and stamps the replay', async () => {
    // `x-death` matters most: the attempt counter is derived from it, so a
    // replayed message carrying the old record would start several attempts in
    // and be parked again almost immediately.
    park('unknown_currency');
    await expect.poll(() => broker.depth(QUEUE_PARKED), { timeout: 10_000 }).toBe(1);

    await drain(false);

    const message = await broker.take(QUEUE_BETS, 10_000);
    broker.ack(message);
    const headers = message.properties.headers ?? {};

    expect(headers[HEADER_X_DEATH]).toBeUndefined();
    expect(headers[HEADER_PARK_REASON]).toBeUndefined();
    expect(headers[HEADER_PARK_ROUTING_KEY]).toBeUndefined();
    expect(headers[HEADER_REPLAYED_AT]).toBeTypeOf('string');
  });

  it('changes nothing on a dry run, however many it reports', async () => {
    // A dry run that consumed what it printed would be the worst possible
    // version of this tool. It reported the same message `--limit` times once,
    // because each one was requeued immediately and came back to the head of
    // the queue — hence the held-then-nacked-all design.
    park('unknown_currency');
    park('attempts_exhausted');
    await expect.poll(() => broker.depth(QUEUE_PARKED), { timeout: 10_000 }).toBe(2);

    const summary = await drain(true);

    expect(summary).toEqual({ replayed: 2, skipped: 0 });
    await expect.poll(() => broker.depth(QUEUE_PARKED), { timeout: 10_000 }).toBe(2);
    expect(await broker.depth(QUEUE_BETS)).toBe(0);
  });

  it('leaves behind what it cannot route, and says so', async () => {
    // Guessing would be worse than leaving it for a human: the parking queue
    // is bound to one key of its own, so a message whose stored key is missing
    // or unrecognised has no honest destination.
    park('unknown_currency', {}, null);
    park('unknown_currency', {}, 'bet.invented');
    park('unknown_currency');
    await expect.poll(() => broker.depth(QUEUE_PARKED), { timeout: 10_000 }).toBe(3);

    const summary = await drain(false);

    expect(summary).toEqual({ replayed: 1, skipped: 2 });
    // The two it could not route are still there, not dropped.
    await expect.poll(() => broker.depth(QUEUE_PARKED), { timeout: 10_000 }).toBe(2);
    await expect.poll(() => broker.depth(QUEUE_BETS), { timeout: 10_000 }).toBe(1);
  });

  it('finds nothing the second time', async () => {
    park('unknown_currency');
    await expect.poll(() => broker.depth(QUEUE_PARKED), { timeout: 10_000 }).toBe(1);

    expect(await drain(false)).toEqual({ replayed: 1, skipped: 0 });
    expect(await drain(false)).toEqual({ replayed: 0, skipped: 0 });
  });

  it('stops at the limit it was given', async () => {
    for (let index = 0; index < 4; index += 1) park('unknown_currency');
    await expect.poll(() => broker.depth(QUEUE_PARKED), { timeout: 10_000 }).toBe(4);

    expect(await drain(false, 2)).toEqual({ replayed: 2, skipped: 0 });
    await expect.poll(() => broker.depth(QUEUE_PARKED), { timeout: 10_000 }).toBe(2);
  });
});
