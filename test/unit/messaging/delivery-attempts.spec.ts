import type { MessagePropertyHeaders } from 'amqplib';
import { attemptFromHeaders } from '../../../src/messaging/delivery-attempts.js';
import { QUEUE_BETS, QUEUE_RETRY } from '../../../src/messaging/topology.js';

function headers(xDeath: unknown): MessagePropertyHeaders {
  return { 'x-death': xDeath } as unknown as MessagePropertyHeaders;
}

function fromMain(count: number, reason = 'rejected'): Record<string, unknown> {
  return {
    queue: QUEUE_BETS,
    reason,
    exchange: 'bets',
    'routing-keys': ['bet.settled'],
    count,
  };
}

describe('attemptFromHeaders', () => {
  it('counts a first delivery as attempt 1', () => {
    expect(attemptFromHeaders(undefined)).toBe(1);
  });

  it('counts a message that has never been dead-lettered as attempt 1', () => {
    expect(attemptFromHeaders({})).toBe(1);
  });

  it('reads the hop count, not the number of entries', () => {
    // The one that matters. RabbitMQ groups hops by (queue, reason) and
    // increments `count` inside the entry, so counting entries would report 1
    // forever — and a retry loop that never reaches its limit never ends.
    expect(attemptFromHeaders(headers([fromMain(3)]))).toBe(4);
  });

  it('sums the hops a message took for different reasons', () => {
    // A message can leave the main queue two ways: the consumer rejects it, or
    // the quorum queue's delivery limit gives up on it. Each gets its own
    // x-death entry, and taking only the first undercounts the attempts — so a
    // message outlives the budget it was given.
    expect(attemptFromHeaders(headers([fromMain(2), fromMain(1, 'delivery_limit')]))).toBe(4);
  });

  it('ignores hops through other queues', () => {
    const xDeath = [
      { queue: QUEUE_RETRY, reason: 'expired', exchange: 'bets.retry', count: 7 },
      fromMain(2),
    ];

    expect(attemptFromHeaders(headers(xDeath))).toBe(3);
  });

  it('treats a header it cannot read as a first delivery', () => {
    // Throwing here would leave the classifier unable to classify, which turns
    // a malformed header into an unhandled error on every redelivery.
    expect(attemptFromHeaders(headers('nonsense'))).toBe(1);
    expect(attemptFromHeaders(headers([]))).toBe(1);
    expect(attemptFromHeaders(headers([{ queue: QUEUE_BETS }]))).toBe(1);
    expect(attemptFromHeaders(headers([{ queue: QUEUE_BETS, count: 'many' }]))).toBe(1);
  });
});
