import { ZodError } from 'zod';
import type { Env } from './env.schema.js';
import { ConfigurationError } from '../common/errors.js';
import { envSchema } from './env.schema.js';

/** Connections kept aside for reads and the health check. */
const POOL_SPARE = 5;

/** Validated configuration, shaped by concern rather than by variable name. */
export interface AppConfig {
  readonly nodeEnv: Env['NODE_ENV'];
  readonly port: number;
  readonly log: {
    readonly level: Env['LOG_LEVEL'];
    readonly pretty: boolean;
  };
  readonly databaseUrl: string;
  /**
   * Maximum pooled connections.
   *
   * Tied to the prefetch rather than left to the driver's default of ten: a
   * delivery is handled in a transaction, so `prefetch` handlers in flight
   * want `prefetch` connections, and a smaller pool makes the rest queue
   * invisibly — throughput drops with nothing in the logs to say why. The
   * spare few are for the health check and the leaderboard reads, which must
   * not wait behind a backlog of writes.
   */
  readonly databasePoolMax: number;
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
 * @throws ConfigurationError listing every offending variable at once — one
 *         failed boot per misconfiguration, not one per variable.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  let env: Env;

  try {
    env = envSchema.parse(source);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;

    throw new ConfigurationError(
      error.issues.map((issue) => ({
        // The root refinement — a window that ends before it starts — has no
        // single variable to blame, so it is attributed to the whole config.
        path: issue.path.length > 0 ? issue.path.join('.') : 'FX_RATES/TOURNAMENT_*',
        message: issue.message,
      })),
    );
  }

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    log: { level: env.LOG_LEVEL, pretty: env.LOG_PRETTY },
    databaseUrl: env.DATABASE_URL,
    databasePoolMax: env.DATABASE_POOL_MAX ?? env.RABBITMQ_PREFETCH + POOL_SPARE,
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
