import type { Tournament } from '../entities/index.js';

export interface TournamentWindow {
  readonly code: string;
  /** Inclusive. */
  readonly startsAt: Date;
  /** Exclusive. */
  readonly endsAt: Date;
}

export interface TournamentCodeQuery {
  readonly code: string;
}

export interface TournamentsRepositoryPort {
  /**
   * Makes the configured tournament exist and returns it.
   *
   * Config is the source of truth, so this runs on boot and overwrites the
   * window. Points already scored are never recomputed — moving the window
   * does not retroactively include or exclude bets.
   */
  upsertByCode(window: TournamentWindow): Promise<Tournament>;

  findByCode(query: TournamentCodeQuery): Promise<Tournament | null>;
}

export const TOURNAMENTS_REPOSITORY = Symbol('TournamentsRepositoryPort');
