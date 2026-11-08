import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/config.module.js';
import {
  BETS_REPOSITORY,
  PLAYER_SCORES_REPOSITORY,
  TOURNAMENTS_REPOSITORY,
  UNIT_OF_WORK,
} from './contracts/index.js';
import { createDataSourceOptions } from './data-source.js';
import {
  BetsRepository,
  PlayerScoresRepository,
  TournamentsRepository,
} from './repositories/index.js';
import { TypeOrmUnitOfWork } from './unit-of-work.js';

/**
 * Owns the connection and the persistence adapters.
 *
 * Everything is exported behind a token, not a class: the services depend on
 * the ports in `./contracts`, so a unit test provides a plain object and an
 * integration test provides these. `TypeOrmModule.forRootAsync` is here for
 * lifecycle only — connect on boot, close on shutdown.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createDataSourceOptions(config),
    }),
  ],
  providers: [
    { provide: BETS_REPOSITORY, useClass: BetsRepository },
    { provide: PLAYER_SCORES_REPOSITORY, useClass: PlayerScoresRepository },
    { provide: TOURNAMENTS_REPOSITORY, useClass: TournamentsRepository },
    { provide: UNIT_OF_WORK, useClass: TypeOrmUnitOfWork },
  ],
  exports: [BETS_REPOSITORY, PLAYER_SCORES_REPOSITORY, TOURNAMENTS_REPOSITORY, UNIT_OF_WORK],
})
export class DatabaseModule {}
