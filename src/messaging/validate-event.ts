import { plainToInstance } from 'class-transformer';
import type { ClassConstructor } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PoisonMessageError } from '../common/errors.js';

export interface ValidateEventInput<T extends object> {
  /** The validator class — `BetSettledEventDto` or `BetRollbackEventDto`. */
  readonly dto: ClassConstructor<T>;
  /** The raw AMQP body. */
  readonly payload: unknown;
}

/** What the body turned out to be, for the parked message's headers. */
function describe(payload: unknown): string {
  if (payload === null) return 'null';
  if (Buffer.isBuffer(payload)) return 'a non-JSON buffer';
  if (Array.isArray(payload)) return 'an array';

  return typeof payload;
}

/**
 * Turns a raw AMQP body into a validated DTO.
 *
 * The buffer case is not hypothetical: the subscription is declared with
 * `allowNonJsonMessages`, so a body that is not JSON arrives here as raw bytes
 * instead of throwing inside the library, where there would be nothing useful
 * to attach a reason to.
 *
 * @throws PoisonMessageError with reason `invalid_schema` — a payload that
 *         fails validation fails identically on every redelivery, so it must
 *         never be retried.
 */
export function validateEvent<T extends object>({ dto, payload }: ValidateEventInput<T>): T {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    Buffer.isBuffer(payload)
  ) {
    throw new PoisonMessageError(
      'invalid_schema',
      `Event body must be a JSON object, got ${describe(payload)}`,
      { received: describe(payload) },
    );
  }

  let event: T;
  let failures: ReturnType<typeof validateSync>;

  try {
    event = plainToInstance(dto, payload);
    // `whitelist` drops properties the contract does not declare, which is
    // what makes a producer adding a field a non-event rather than an outage.
    failures = validateSync(event, { whitelist: true });
  } catch (error) {
    // Transforming or validating a payload can throw rather than return
    // failures — a body nested deeply enough overflows the stack inside
    // class-transformer's recursion, and a getter on a plain object can throw
    // anything at all.
    //
    // Whatever it was, it is a property of this payload and will happen again
    // on every redelivery, so it belongs here as poison rather than escaping
    // as a generic error. Uncaught, the classifier reads it as infrastructure
    // and sends the message round the retry hop for its whole budget: five
    // deliveries and forty seconds spent on a message that can never be read.
    throw new PoisonMessageError(
      'invalid_schema',
      `Event body could not be read: ${error instanceof Error ? error.message : String(error)}`,
      { received: describe(payload) },
    );
  }

  if (failures.length > 0) {
    throw new PoisonMessageError(
      'invalid_schema',
      `Event failed validation: ${failures.map((failure) => failure.property).join(', ')}`,
      {
        fields: failures.map((failure) => failure.property),
        constraints: failures.map((failure) => Object.values(failure.constraints ?? {})).flat(),
      },
    );
  }

  return event;
}
