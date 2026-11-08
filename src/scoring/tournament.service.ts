import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/config.module.js';

import { TOURNAMENTS_REPOSITORY } from '../database/contracts/index.js';
import type { TournamentsRepositoryPort } from '../database/contracts/index.js';
import type { ActiveTournament, TournamentPort } from './scoring.contract.js';

@Injectable()
export class TournamentService implements TournamentPort, OnModuleInit {
  /** Resolved once on boot; every event reads it from here. */
  private active: ActiveTournament | undefined;

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
  async onModuleInit(): Promise<void> {
    const { code, startsAt, endsAt } = this.config.tournament;
    const record = await this.tournaments.upsertByCode({ code, startsAt, endsAt });

    this.active = {
      id: record.id,
      code: record.code,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
    };
  }

  getActive(): ActiveTournament {
    if (this.active === undefined) {
      throw new Error(
        'The active tournament has not been resolved yet. Scoring before ' +
          'onModuleInit would have to invent a tournament id, and every row ' +
          'written under it would be unreachable.',
      );
    }

    return this.active;
  }

  isWithinWindow(settledAt: Date): boolean {
    const { startsAt, endsAt } = this.getActive();

    return settledAt.getTime() >= startsAt.getTime() && settledAt.getTime() < endsAt.getTime();
  }
}
