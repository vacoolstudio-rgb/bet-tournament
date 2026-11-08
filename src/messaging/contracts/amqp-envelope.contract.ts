import type { PoisonReason } from '../../common/errors.js';

/**
 * The AMQP metadata this service reads and writes.
 *
 * Modelled rather than poked at: `message.properties.headers` is typed as a
 * bag of `any` by amqplib, and the retry count lives inside a nested array
 * that is easy to misread. A named shape makes the one place that parses it
 * reviewable, and the parking headers a contract the tests can assert.
 */

/**
 * One dead-letter hop, as RabbitMQ records it in `x-death`.
 *
 * Entries are grouped by (queue, reason), and `count` is how many times the
 * message took that same hop — so the retry attempt is derived from `count`,
 * not from the number of entries.
 */
export interface XDeathEntry {
  readonly queue: string;
  readonly reason: 'rejected' | 'expired' | 'maxlen' | 'delivery_limit';
  readonly exchange: string;
  readonly 'routing-keys': readonly string[];
  readonly count: number;
  readonly time?: unknown;
}

/** Headers a parked message carries, so a human can tell why it is there. */
export interface ParkedMessageHeaders {
  /** Why it can never succeed. */
  readonly 'x-park-reason': PoisonReason | 'attempts_exhausted';
  /** `error.name: error.message`, truncated. */
  readonly 'x-park-error': string;
  /** The routing key it arrived with — `bet.settled`, `bet.rollback`, or junk. */
  readonly 'x-park-routing-key': string;
  /** Deliveries made before giving up; 1 for a payload rejected on sight. */
  readonly 'x-park-attempts': number;
  /** When it was parked, ISO-8601 with zone. */
  readonly 'x-park-at': string;
}
