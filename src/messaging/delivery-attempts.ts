import type { MessagePropertyHeaders } from 'amqplib';
import { notImplemented } from '../common/not-implemented.error.js';

/**
 * How many times this message has been delivered, counting the current one.
 *
 * RabbitMQ records dead-letter hops in `x-death`, so the retry queue's round
 * trips are countable without the producer carrying a counter: a message that
 * has never been dead-lettered is attempt 1, and each `expired` hop through
 * the retry queue adds one.
 *
 * Reads `count` on the matching entry rather than the number of entries —
 * RabbitMQ groups hops by (queue, reason) and increments `count`, so counting
 * entries would report 1 forever.
 *
 * @see XDeathEntry
 */
export function attemptFromHeaders(_headers: MessagePropertyHeaders | undefined): number {
  return notImplemented('attemptFromHeaders');
}
