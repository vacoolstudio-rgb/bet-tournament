import { HEADER_REPLAYED_AT, headersFor, routingKeyFor } from '../../../tools/replay.js';
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
