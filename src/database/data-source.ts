import { DataSource } from 'typeorm';
import type { DataSourceOptions } from 'typeorm';
import type { AppConfig } from '../config/app-config.js';
import { Bet, PlayerScore, Tournament } from './entities/index.js';
import { migrations } from './migrations/index.js';

/**
 * `synchronize` is off and stays off: the schema is defined by the migrations,
 * which are reviewable SQL, and a decorator edit must never reshape a table
 * holding balances.
 */
export function createDataSourceOptions(config: AppConfig): DataSourceOptions {
  return {
    type: 'postgres',
    url: config.databaseUrl,
    entities: [Tournament, Bet, PlayerScore],
    migrations,
    synchronize: false,
    migrationsRun: false,
    // Sized from the prefetch, not left at the driver's ten — see
    // AppConfig.databasePoolMax for why the two belong together.
    extra: { max: config.databasePoolMax },
    logging: config.nodeEnv === 'development' ? ['error', 'warn', 'migration'] : ['error'],
  };
}

export function createDataSource(config: AppConfig): DataSource {
  return new DataSource(createDataSourceOptions(config));
}
