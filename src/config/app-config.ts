import type { Env } from './env.schema.js';
import { envSchema } from './env.schema.js';

/** Validated configuration, shaped by concern rather than by variable name. */
export interface AppConfig {
  readonly nodeEnv: Env['NODE_ENV'];
  readonly port: number;
  readonly log: {
    readonly level: Env['LOG_LEVEL'];
    readonly pretty: boolean;
  };
  readonly databaseUrl: string;
  readonly rabbit: {
    readonly url: string;
    readonly prefetch: number;
    /** Delivery attempts before the message is parked. */
    readonly maxAttempts: number;
    /** How long a failed message waits in the retry queue. */
    readonly retryTtlMs: number;
  };
  /** Units of USD per 1 unit of the currency, as decimal strings. USD is not here. */
  readonly fxRates: Readonly<Record<string, string>>;
  readonly tournament: {
    readonly code: string;
    /** Inclusive. */
    readonly startsAt: Date;
    /** Exclusive. */
    readonly endsAt: Date;
  };
}

/**
 * Parses and validates the environment.
 *
 * This is a mapping, not logic: the validation lives in the zod schema, so it
 * is written out in full here rather than stubbed.
 *
 * @throws ZodError with every offending variable at once — one failed boot per
 *         misconfiguration, not one per variable.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const env = envSchema.parse(source);

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    log: { level: env.LOG_LEVEL, pretty: env.LOG_PRETTY },
    databaseUrl: env.DATABASE_URL,
    rabbit: {
      url: env.RABBITMQ_URL,
      prefetch: env.RABBITMQ_PREFETCH,
      maxAttempts: env.RABBITMQ_MAX_ATTEMPTS,
      retryTtlMs: env.RABBITMQ_RETRY_TTL_MS,
    },
    fxRates: Object.freeze({ ...env.FX_RATES }),
    tournament: {
      code: env.TOURNAMENT_CODE,
      startsAt: env.TOURNAMENT_STARTS_AT,
      endsAt: env.TOURNAMENT_ENDS_AT,
    },
  };
}
