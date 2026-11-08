import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/config.module.js';
import { createDataSourceOptions } from './data-source.js';
import {
  BetsRepository,
  PlayerScoresRepository,
  TournamentsRepository,
} from './repositories/index.js';

/**
 * Owns the connection and the repositories.
 *
 * `TypeOrmModule.forRootAsync` is used for lifecycle only — connecting on
 * boot and closing on shutdown. The repositories take the `DataSource` and
 * write SQL: the hot path is an upsert with an increment and the leaderboard
 * is a ranking query, neither of which an entity manager expresses well.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createDataSourceOptions(config),
    }),
  ],
  providers: [BetsRepository, PlayerScoresRepository, TournamentsRepository],
  exports: [BetsRepository, PlayerScoresRepository, TournamentsRepository],
})
export class DatabaseModule {}
