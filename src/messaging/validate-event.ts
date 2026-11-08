import type { ClassConstructor } from 'class-transformer';
import { notImplemented } from '../common/not-implemented.error.js';

export interface ValidateEventInput<T extends object> {
  /** The validator class — `BetSettledEventDto` or `BetRollbackEventDto`. */
  readonly dto: ClassConstructor<T>;
  /** The raw AMQP body. */
  readonly payload: unknown;
}

/**
 * Turns a raw AMQP body into a validated DTO.
 *
 * @throws PoisonMessageError with reason `invalid_schema` — a payload that
 *         fails validation fails identically on every redelivery, so it must
 *         never be retried.
 */
export function validateEvent<T extends object>(_input: ValidateEventInput<T>): T {
  return notImplemented('validateEvent');
}
