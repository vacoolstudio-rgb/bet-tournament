import type { ClassConstructor } from 'class-transformer';
import { NotImplementedError } from '../common/not-implemented.error.js';

/**
 * Turns a raw AMQP body into a validated DTO.
 *
 * @throws PoisonMessageError with reason `invalid_schema` — a payload that
 *         fails validation will fail identically on every redelivery, so it
 *         must never be retried.
 */
export function validateEvent<T extends object>(_dto: ClassConstructor<T>, _payload: unknown): T {
  throw new NotImplementedError('validateEvent');
}
