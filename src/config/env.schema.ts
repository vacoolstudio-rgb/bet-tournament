import { z } from 'zod';

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
 * FX rates: units of USD per 1 unit of the currency.
 *
 * Kept as strings, not numbers: a JSON number is a float, and these values are
 * multiplied by money. JSON.parse of `1.08` followed by `String()` round-trips
 * to exactly "1.08", so accepting both shapes costs nothing.
 *
 * USD must not appear — its rate is 1 by definition and a configurable "1"
 * is a configurable way to get it wrong.
 */
const fxRatesSchema = z
  .string()
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
      z.string().regex(/^[A-Z]{3}$/, 'currency must be a 3-letter uppercase code'),
      z.union([z.number().positive(), z.string()]),
    ),
  )
  .transform((rates) =>
    Object.fromEntries(Object.entries(rates).map(([code, rate]) => [code, String(rate)])),
  )
  .refine((rates) => !('USD' in rates), {
    message: 'USD must not be listed in FX_RATES: its rate is hardcoded to 1',
  });

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_PRETTY: booleanFromEnv,

    DATABASE_URL: z.string().min(1),

    RABBITMQ_URL: z.string().min(1),
    RABBITMQ_PREFETCH: z.coerce.number().int().positive().max(1000).default(20),
    RABBITMQ_MAX_ATTEMPTS: z.coerce.number().int().positive().max(100).default(5),
    RABBITMQ_RETRY_TTL_MS: z.coerce.number().int().positive().default(10_000),

    FX_RATES: fxRatesSchema,

    TOURNAMENT_CODE: z.string().min(1).max(64),
    TOURNAMENT_STARTS_AT: z.coerce.date(),
    TOURNAMENT_ENDS_AT: z.coerce.date(),
  })
  .refine((env) => env.TOURNAMENT_ENDS_AT.getTime() > env.TOURNAMENT_STARTS_AT.getTime(), {
    message: 'TOURNAMENT_ENDS_AT must be after TOURNAMENT_STARTS_AT',
    path: ['TOURNAMENT_ENDS_AT'],
  });

export type Env = z.infer<typeof envSchema>;
