import { Decimal } from 'decimal.js';
import { UnknownCurrencyError } from '../../src/common/errors.js';
import type { AppConfig } from '../../src/config/app-config.js';
import type {
  BetsRepositoryPort,
  PlayerScoresRepositoryPort,
  TournamentsRepositoryPort,
  TransactionScope,
  UnitOfWorkPort,
} from '../../src/database/contracts/index.js';
import type {
  BetEventProcessorPort,
  OutcomeClassifierPort,
  ParkingPort,
} from '../../src/messaging/contracts/index.js';
import type { AmqpBroker } from '../../src/messaging/amqp-broker.js';
import type { MetricsPort } from '../../src/observability/metrics.contract.js';
import type { FxPort, TournamentPort } from '../../src/scoring/scoring.contract.js';

/**
 * Stubs for the ports, not in-memory re-implementations.
 *
 * The semantics these doubles would have to imitate — `ON CONFLICT DO NOTHING`,
 * a conditional `UPDATE … WHERE status = 'settled'`, an atomic increment — are
 * the parts most worth testing, and a hand-written fake of them would only ever
 * prove that the fake agrees with itself. So the unit tests assert what a
 * service *does with* a given answer, and the integration tests assert that
 * Postgres really gives that answer.
 */

/** A scope value to thread through; nothing in a unit test reads it. */
export const fakeScope = { manager: {} } as unknown as TransactionScope;

export function fakeUnitOfWork(): UnitOfWorkPort & {
  withTransaction: ReturnType<typeof vi.fn>;
} {
  return {
    withTransaction: vi.fn(async (work: (scope: TransactionScope) => Promise<unknown>) =>
      work(fakeScope),
    ) as never,
  };
}

export function fakeBetsRepository() {
  return {
    insertSettled: vi.fn<BetsRepositoryPort['insertSettled']>(),
    markRolledBack: vi.fn<BetsRepositoryPort['markRolledBack']>(),
    insertTombstone: vi.fn<BetsRepositoryPort['insertTombstone']>(),
    latestScoringSettledAt: vi.fn<BetsRepositoryPort['latestScoringSettledAt']>(),
    findOne: vi.fn<BetsRepositoryPort['findOne']>(),
  };
}

export function fakePlayerScoresRepository() {
  return {
    credit: vi.fn<PlayerScoresRepositoryPort['credit']>(),
    debit: vi.fn<PlayerScoresRepositoryPort['debit']>(),
    decrementCounted: vi.fn<PlayerScoresRepositoryPort['decrementCounted']>(),
    top: vi.fn<PlayerScoresRepositoryPort['top']>(),
    findOne: vi.fn<PlayerScoresRepositoryPort['findOne']>(),
    rankOf: vi.fn<PlayerScoresRepositoryPort['rankOf']>(),
  };
}

export function fakeTournamentsRepository() {
  return {
    upsertByCode: vi.fn<TournamentsRepositoryPort['upsertByCode']>(),
    findByCode: vi.fn<TournamentsRepositoryPort['findByCode']>(),
  };
}

export function fakeFx(rates: Record<string, string> = { EUR: '1.08' }): FxPort {
  return {
    rateFor: (currency: string): Decimal => {
      if (currency === 'USD') return new Decimal(1);
      const rate = rates[currency];
      if (rate === undefined) throw new UnknownCurrencyError(currency);
      return new Decimal(rate);
    },
    toUsd: ({ amount, currency }): Decimal => {
      const rate = rates[currency];
      if (currency !== 'USD' && rate === undefined) throw new UnknownCurrencyError(currency);

      return currency === 'USD' ? amount : amount.mul(new Decimal(rate ?? '1'));
    },
  };
}

export const ACTIVE_TOURNAMENT = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'nov-2026',
  startsAt: new Date('2026-11-01T00:00:00.000Z'),
  endsAt: new Date('2026-12-01T00:00:00.000Z'),
} as const;

export function fakeTournament(overrides: Partial<TournamentPort> = {}) {
  return {
    getActive: vi.fn(() => ACTIVE_TOURNAMENT),
    isWithinWindow: vi.fn(() => true),
    ...overrides,
  };
}

export function fakeProcessor() {
  return { process: vi.fn<BetEventProcessorPort['process']>() };
}

export function fakeClassifier() {
  return { classify: vi.fn<OutcomeClassifierPort['classify']>() };
}

export function fakeParking() {
  return { park: vi.fn<ParkingPort['park']>() };
}

/**
 * Enough of the broker for the consumer: it only registers a handler, and the
 * suite calls `handle` directly.
 */
export function fakeBroker() {
  return {
    consume: vi.fn(() => Promise.resolve()),
    publish: vi.fn(() => Promise.resolve()),
    isConnected: vi.fn(() => true),
  } as unknown as AmqpBroker;
}

export function fakeMetrics() {
  return {
    recordAck: vi.fn<MetricsPort['recordAck']>(),
    recordRetry: vi.fn<MetricsPort['recordRetry']>(),
    recordPark: vi.fn<MetricsPort['recordPark']>(),
    observeProcessing: vi.fn<MetricsPort['observeProcessing']>(),
    render: vi.fn<MetricsPort['render']>(),
  };
}

/** A complete, valid config; override only what a test is about. */
export function fakeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    log: { level: 'error', pretty: false },
    databaseUrl: 'postgresql://user:pass@localhost:5432/db',
    databasePoolMax: 25,
    rabbit: {
      url: 'amqp://user:pass@localhost:5672',
      prefetch: 20,
      maxAttempts: 5,
      retryTtlMs: 10_000,
    },
    fxRates: { EUR: '1.08', GBP: '1.27', UAH: '0.024' },
    tournament: {
      code: ACTIVE_TOURNAMENT.code,
      startsAt: ACTIVE_TOURNAMENT.startsAt,
      endsAt: ACTIVE_TOURNAMENT.endsAt,
    },
    ...overrides,
  };
}
