import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/config.module.js';
import { notImplemented } from '../common/not-implemented.error.js';
import { TOURNAMENTS_REPOSITORY } from '../database/contracts/index.js';
import type { TournamentsRepositoryPort } from '../database/contracts/index.js';
import type { ActiveTournament, TournamentPort } from './scoring.contract.js';

@Injectable()
export class TournamentService implements TournamentPort, OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TOURNAMENTS_REPOSITORY) private readonly tournaments: TournamentsRepositoryPort,
  ) {}

  /**
   * Makes the configured tournament exist and caches it.
   *
   * The window lives in the config and the row is upserted from it on every
   * boot, so there is exactly one source of truth.
   */
  onModuleInit(): Promise<void> {
    return notImplemented('TournamentService.onModuleInit', this.config, this.tournaments);
  }

  getActive(): ActiveTournament {
    return notImplemented('TournamentService.getActive', this.config);
  }

  isWithinWindow(_settledAt: Date): boolean {
    return notImplemented('TournamentService.isWithinWindow', this.config);
  }
}
