import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import request from 'supertest';
import type { Agent } from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../../../src/app.module.js';
import { configureApp } from '../../../src/app.setup.js';
import type { AppConfig } from '../../../src/config/app-config.js';
import { APP_CONFIG } from '../../../src/config/config.module.js';
import { createDataSource } from '../../../src/database/data-source.js';
import { buildTopology } from '../../../src/messaging/topology.js';
import { connectBroker } from './broker.js';
import type { Broker } from './broker.js';

/** Short enough to wait for in a test, long enough to be a real delay. */
export const TEST_RETRY_TTL_MS = 1_200;

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 0,
    log: { level: 'error', pretty: false },
    databaseUrl: inject('databaseUrl'),
    rabbit: {
      url: inject('amqpUrl'),
      prefetch: 20,
      maxAttempts: 3,
      retryTtlMs: TEST_RETRY_TTL_MS,
    },
    fxRates: { EUR: '1.08', GBP: '1.27', UAH: '0.024' },
    tournament: {
      code: 'nov-2026',
      startsAt: new Date('2026-11-01T00:00:00.000Z'),
      endsAt: new Date('2026-12-01T00:00:00.000Z'),
    },
    ...overrides,
  };
}

export interface Harness {
  app: INestApplication;
  config: AppConfig;
  http: Agent;
  close(): Promise<void>;
}

/**
 * Boots the real application against the containers.
 *
 * The configuration is provided as a value rather than read from the
 * environment, so a suite can move the tournament window or shorten the retry
 * delay without a process-wide side effect.
 */
export async function startApp(overrides: Partial<AppConfig> = {}): Promise<Harness> {
  const config = testConfig(overrides);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return {
    app,
    config,
    http: request(app.getHttpServer()),
    close: async (): Promise<void> => {
      await app.close();
    },
  };
}

/** A migrated database, for suites that drive the repositories directly. */
export async function startDatabase(): Promise<DataSource> {
  const dataSource = createDataSource(testConfig());
  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'each' });

  return dataSource;
}

/**
 * Clears the data a test writes, leaving the tournament row alone.
 *
 * The running application caches the tournament it upserted on boot, so
 * truncating that row and inserting a fresh one would leave every query
 * pointing at an id that no longer exists — and the suite would fail against a
 * perfectly correct implementation. Use {@link resetAll} when the application
 * is restarted afterwards anyway.
 */
export async function resetScores(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE player_scores, bets');
}

/** Clears everything, including tournaments. Only safe before a (re)boot. */
export async function resetAll(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE player_scores, bets, tournaments CASCADE');
}

/**
 * Removes and re-declares the broker objects, so a suite starts with empty
 * queues and its own retry delay rather than whatever the previous one left.
 */
export async function resetBroker(): Promise<Broker> {
  const broker = await connectBroker(inject('amqpUrl'));
  await broker.reset(buildTopology({ retryTtlMs: TEST_RETRY_TTL_MS }));

  return broker;
}
