import type { PoisonReason } from '../common/errors.js';

/**
 * Every reason a message can be acknowledged as handled.
 *
 * `duplicate`, `already_rolled_back` and `tombstoned` are not failures: they
 * are what at-least-once delivery and out-of-order events look like when
 * idempotency works.
 */
export type AckReason =
  | 'scored'
  | 'scored_zero'
  | 'duplicate'
  | 'already_rolled_back'
  | 'out_of_window'
  | 'rolled_back'
  | 'tombstoned';

/**
 * What the consumer decided to do with a delivery.
 *
 * Keeping this a value rather than a side effect is what makes the error
 * policy unit-testable: the classifier is a pure function of (error, attempt),
 * and the AMQP adapter only translates its answer into ack / nack / publish.
 */
export type MessageOutcome =
  | { readonly kind: 'ack'; readonly reason: AckReason }
  | { readonly kind: 'retry'; readonly attempt: number; readonly error: Error }
  | {
      readonly kind: 'park';
      readonly reason: PoisonReason | 'attempts_exhausted';
      readonly attempts: number;
      readonly error: Error;
    };
