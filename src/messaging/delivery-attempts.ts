import type { MessagePropertyHeaders } from 'amqplib';
import { NotImplementedError } from '../common/not-implemented.error.js';

/**
 * How many times this message has been delivered, counting the current one.
 *
 * RabbitMQ records dead-letter hops in the `x-death` header, so the retry
 * queue's round trips are countable without the producer carrying a counter.
 * A message that has never been dead-lettered is attempt 1.
 */
export function attemptFromHeaders(_headers: MessagePropertyHeaders | undefined): number {
  throw new NotImplementedError('attemptFromHeaders');
}
