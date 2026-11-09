import { z } from 'zod';
import { BASE_CURRENCY, CURRENCY_PATTERN } from '../common/currency.js';
import { isFxRate, MAX_FX_RATE } from '../common/money.js';

/**
 * Environment contract. Invalid configuration fails the process on boot
 * rather than surfacing as a mystery at the first event.
 */

/** `"true"`/`"false"` from the environment, as a real boolean. */
const booleanFromEnv = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

/**
 * A required variable that says which one it is when it is missing.
 *
 * Zod's own text for an absent value is "Invalid input: expected string,
 * received undefined", repeated once per variable. The path is printed
 * alongside it, so the name is not lost — but the sentence carries none of the
 * information, and six of them in a column is what someone sees the first time
 * they run this after a clone.
 */
function required(name: string) {
  return z.string({ error: `${name} is required` });
}

/** An instant, named in its own error messages. */
function isoInstant(name: string) {
  return z
    .string({ error: `${name} is required, as an ISO-8601 instant like 2026-11-01T00:00:00Z` })
    .min(1, `${name} must not be empty`)
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      error: `${name} must be an ISO-8601 instant like 2026-11-01T00:00:00Z`,
    })
    .transform((value) => new Date(value));
}

/**
 * FX rates: units of USD per 1 unit of the currency.
 *
 * Kept as strings, not numbers: a JSON number is a float, and these values are
 * multiplied by money. JSON.parse of `1.08` followed by `String()` round-trips
 * to exactly "1.08", so accepting both shapes costs nothing.
 *
 * USD must not appear — its rate is 1 by definition and a configurable "1"
 * is a configurable way to get it wrong.
 */
const fxRatesSchema = required('FX_RATES')
  .transform((raw, ctx): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'FX_RATES must be a JSON object' });
      return z.NEVER;
    }
  })
  .pipe(
    z.record(
      z.string().regex(CURRENCY_PATTERN, 'currency must be 3 to 10 uppercase letters or digits'),
      // Validated through the same predicate the money module uses, because
      // `z.string()` alone accepted "abc" and "-1" as rates: the union let a
      // string past without a single check.
      z.union([z.number(), z.string()]).refine(isFxRate, {
        message: `rate must be a positive decimal no greater than ${MAX_FX_RATE}`,
      }),
    ),
  )
  .transform((rates) =>
    Object.fromEntries(Object.entries(rates).map(([code, rate]) => [code, String(rate)])),
  )
  .refine((rates) => !(BASE_CURRENCY in rates), {
    message: `${BASE_CURRENCY} must not be listed in FX_RATES: its rate is hardcoded to 1`,
  });

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_PRETTY: booleanFromEnv,

    // Schemes are checked so a typo fails the boot with the variable's name
    // instead of a connection error ten seconds later.
    /**
     * Connections the pool may open. Optional: the default is derived from the
     * prefetch below, because that is what decides how many handlers can be
     * mid-transaction at once.
     */
    DATABASE_POOL_MAX: z.coerce.number().int().positive().max(1000).optional(),

    DATABASE_URL: required('DATABASE_URL').regex(
      /^postgres(ql)?:\/\//,
      'DATABASE_URL must start with postgres:// or postgresql://',
    ),

    RABBITMQ_URL: required('RABBITMQ_URL').regex(
      /^amqps?:\/\//,
      'RABBITMQ_URL must start with amqp:// or amqps://',
    ),
    RABBITMQ_PREFETCH: z.coerce.number().int().positive().max(1000).default(20),
    RABBITMQ_MAX_ATTEMPTS: z.coerce.number().int().positive().max(100).default(5),
    RABBITMQ_RETRY_TTL_MS: z.coerce.number().int().positive().default(10_000),

    FX_RATES: fxRatesSchema,

    TOURNAMENT_CODE: required('TOURNAMENT_CODE').min(1).max(64),
    // Required-then-coerced, rather than `z.coerce.date()` alone: coercion
    // turns a missing variable into an Invalid Date, and the message for that
    // is "expected date, received Date", which tells a reader nothing. The
    // string check runs first, so an absent variable says it is absent and a
    // misspelled one says what was expected.
    TOURNAMENT_STARTS_AT: isoInstant('TOURNAMENT_STARTS_AT'),
    TOURNAMENT_ENDS_AT: isoInstant('TOURNAMENT_ENDS_AT'),
  })
  .refine((env) => env.TOURNAMENT_ENDS_AT.getTime() > env.TOURNAMENT_STARTS_AT.getTime(), {
    message: 'TOURNAMENT_ENDS_AT must be after TOURNAMENT_STARTS_AT',
    path: ['TOURNAMENT_ENDS_AT'],
  });

export type Env = z.infer<typeof envSchema>;
