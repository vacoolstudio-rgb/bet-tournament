/** Input and output for the leaderboard read model. */

export interface LeaderboardQuery {
  /** 1..100; the task asks for a top-100 and that is also the ceiling. */
  readonly limit: number;
  /** From `X-Player-Id`; absent means the caller gets no `me` block. */
  readonly playerId?: string | undefined;
}

export interface LeaderboardEntry {
  /** 1-based, unique: the sort key is total order, so no two rows share one. */
  readonly rank: number;
  readonly playerId: string;
  /** Whole points — "1 point per 1 USD", truncated towards zero. */
  readonly points: number;
  /**
   * Exact points. Ranking uses this, not the truncated value, so two players
   * can show equal `points` and hold different ranks.
   */
  readonly pointsExact: string;
  /** Settled bets counted, losing ones included. */
  readonly betsCounted: number;
}

/**
 * The caller's own standing.
 *
 * `rank` is null for a player with no scoring bets: the service does not know
 * how many players the tournament has, so it cannot invent a last place.
 */
export interface PlayerStanding extends Omit<LeaderboardEntry, 'rank'> {
  readonly rank: number | null;
}

export interface TournamentInfo {
  readonly code: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: 'pending' | 'active' | 'finished';
}

export interface LeaderboardView {
  readonly tournament: TournamentInfo;
  readonly top: readonly LeaderboardEntry[];
  readonly me: PlayerStanding | null;
  readonly generatedAt: string;
}

export interface LeaderboardPort {
  get(query: LeaderboardQuery): Promise<LeaderboardView>;
}

export const LEADERBOARD_SERVICE = Symbol('LeaderboardPort');
