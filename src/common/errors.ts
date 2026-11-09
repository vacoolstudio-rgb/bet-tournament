/**
 * Why an event can never succeed, no matter how many times it is redelivered.
 *
 * Every value here means "park it and move on": retrying needs a new deploy
 * (a currency added to the config) or a new producer (a fixed payload), not
 * another attempt.
 */
export type PoisonReason =
  'invalid_schema' | 'unknown_currency' | 'amount_out_of_range' | 'unknown_routing_key';

/**
 * A message that must not be retried.
 *
 * The distinction from {@link RetryableError} is the whole point of the
 * consumer's error handling: a poison message retried five times is five
 * pointless round trips, and a transient database outage parked as poison is
 * lost money.
 */
export class PoisonMessageError extends Error {
  constructor(
    readonly reason: PoisonReason,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'PoisonMessageError';
  }
}

/**
 * A failure that a later attempt can plausibly survive: the database is down,
 * the transaction deadlocked, a lock timed out.
 */
export class RetryableError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

/** No rate for this currency in `FX_RATES`; scoring the bet is impossible. */
export class UnknownCurrencyError extends PoisonMessageError {
  constructor(readonly currency: string) {
    super('unknown_currency', `No FX rate configured for currency "${currency}"`, { currency });
    this.name = 'UnknownCurrencyError';
  }
}

/** A money amount outside what the schema can hold without silent rounding. */
export class AmountOutOfRangeError extends PoisonMessageError {
  constructor(
    readonly field: string,
    readonly value: string,
    detail: string,
  ) {
    super('amount_out_of_range', `Field "${field}" with value "${value}" ${detail}`, {
      field,
      value,
    });
    this.name = 'AmountOutOfRangeError';
  }
}

/**
 * Configuration that cannot be used, phrased for whoever reads the logs.
 *
 * Raised instead of letting the ZodError out, because the raw one is forty
 * lines of JSON — `code`, `expected`, `received`, a `path` array per issue —
 * printed by the framework's exception handler after "Starting Nest
 * application...", which makes a missing environment variable look like the
 * framework crashed. Read in `main.ts` before the framework starts, and it
 * carries every offending variable at once: one failed boot per
 * misconfiguration, not one per variable.
 */
export class ConfigurationError extends Error {
  constructor(readonly issues: readonly { path: string; message: string }[]) {
    super(
      [
        'Configuration is invalid:',
        ...issues.map(({ path, message }) => `  ${path}: ${message}`),
      ].join('\n'),
    );
    this.name = 'ConfigurationError';
  }
}
