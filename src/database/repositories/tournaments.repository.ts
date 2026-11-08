import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { notImplemented } from '../../common/not-implemented.error.js';
import type { Tournament } from '../entities/index.js';

export interface TournamentWindow {
  readonly code: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

@Injectable()
export class TournamentsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Makes the configured tournament exist and returns it.
   *
   * The config is the source of truth, so this runs on boot and overwrites the
   * window. Already-scored points are not recomputed — moving the window does
   * not retroactively include or exclude bets, and that is documented rather
   * than discovered.
   */
  upsertByCode(_window: TournamentWindow): Promise<Tournament> {
    return notImplemented('TournamentsRepository.upsertByCode', this.dataSource);
  }

  findByCode(_code: string): Promise<Tournament | null> {
    return notImplemented('TournamentsRepository.findByCode', this.dataSource);
  }
}
