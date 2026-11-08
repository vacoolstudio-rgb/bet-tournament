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

/** A tournament row as the port exposes it, with its generated id. */
export interface TournamentRecord extends TournamentWindow {
  readonly id: string;
  readonly createdAt: Date;
}

export interface TournamentsRepositoryPort {
  /**
   * Makes the configured tournament exist and returns it.
   *
   * Config is the source of truth, so this runs on boot and overwrites the
   * window. Points already scored are never recomputed — moving the window
   * does not retroactively include or exclude bets.
   */
  upsertByCode(window: TournamentWindow): Promise<TournamentRecord>;

  findByCode(query: TournamentCodeQuery): Promise<TournamentRecord | null>;
}

export const TOURNAMENTS_REPOSITORY = Symbol('TournamentsRepositoryPort');
