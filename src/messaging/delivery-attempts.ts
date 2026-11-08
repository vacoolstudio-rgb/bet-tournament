import type { MessagePropertyHeaders } from 'amqplib';
import type { XDeathEntry } from './contracts/index.js';
import { HEADER_X_DEATH, QUEUE_BETS } from './topology.js';

/**
 * How many times this message has been delivered, counting the current one.
 *
 * RabbitMQ records dead-letter hops in `x-death`, so the retry queue's round
 * trips are countable without the producer carrying a counter: a message that
 * has never been dead-lettered is attempt 1, and each hop out of the main
 * queue adds one.
 *
 * Two details decide whether this number is right. It reads `count` rather
 * than the number of entries, because RabbitMQ groups hops by (queue, reason)
 * and increments `count` inside the entry — counting entries would report 1
 * forever. And it sums every entry for the main queue rather than taking the
 * first, because a message leaves that queue for two different reasons:
 * `rejected` when the consumer nacks it, `delivery_limit` when the quorum
 * queue gives up on it. Reading one undercounts, and the message outlives the
 * budget it was given.
 *
 * Never throws. A header it cannot make sense of counts as a first delivery:
 * failing here would leave the classifier unable to classify, turning a
 * malformed header into an unhandled error on every redelivery.
 */
export function attemptFromHeaders(headers: MessagePropertyHeaders | undefined): number {
  const deaths: unknown = headers?.[HEADER_X_DEATH];
  if (!Array.isArray(deaths)) return 1;

  let hops = 0;

  for (const death of deaths as unknown[]) {
    if (typeof death !== 'object' || death === null) continue;

    const { queue, count } = death as Partial<XDeathEntry>;
    if (queue !== QUEUE_BETS) continue;
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) continue;

    hops += count;
  }

  return hops + 1;
}
