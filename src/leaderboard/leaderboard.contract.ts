/** Input and output for the leaderboard read model. */

/** The task asks for a top-100, so that is both the default and the ceiling. */
export const DEFAULT_LEADERBOARD_LIMIT = 100;
export const MAX_LEADERBOARD_LIMIT = 100;

export interface LeaderboardQuery {
  /** 1..{@link MAX_LEADERBOARD_LIMIT}. An unbounded limit on a ranked query
   * is a free table scan for anyone who asks. */
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
 * `rank` is null **exactly when `points` is 0**, and that equivalence is the
 * contract rather than an implementation detail. Two players can both have
 * nothing: one never placed a bet (no row at all), the other had every bet
 * rolled back (a row with zero points). Ranking by row existence would give
 * the second one a position and the first one none, for the same achievement.
 *
 * A player who has not scored has no position in the tournament, and the
 * service could not invent one honestly anyway — it does not know how many
 * players exist.
 *
 * An unknown player is reported as zeroes rather than omitted: the caller
 * asked about themselves and "you have nothing yet" is the answer, while a
 * missing block would be indistinguishable from a missing header.
 */
export interface PlayerStanding extends Omit<LeaderboardEntry, 'rank'> {
  readonly rank: number | null;
}

export type TournamentStatus = 'pending' | 'active' | 'finished';

export interface TournamentInfo {
  readonly code: string;
  /** ISO-8601 with zone, inclusive. */
  readonly startsAt: string;
  /** ISO-8601 with zone, exclusive. */
  readonly endsAt: string;
  /** Derived from the window and the current instant, not stored. */
  readonly status: TournamentStatus;
}

export interface LeaderboardView {
  readonly tournament: TournamentInfo;
  /**
   * Up to `limit` rows, rank ascending from 1.
   *
   * Only players who have scored. A player with zero points has no position —
   * `me.rank` is null for them — so listing them here would have the service
   * answer the same question two different ways: rank 3 in the board and no
   * rank at all in `me`, for one player in one response.
   *
   * A player in the top also appears in `me`, duplicated on purpose, so a
   * client never has to search the list to find out whether the caller is in
   * it.
   */
  readonly top: readonly LeaderboardEntry[];
  /** Null when `X-Player-Id` was absent. */
  readonly me: PlayerStanding | null;
  /** ISO-8601 with zone. The board is read uncached, so this is "now". */
  readonly generatedAt: string;
}

export interface LeaderboardPort {
  get(query: LeaderboardQuery): Promise<LeaderboardView>;
}

export const LEADERBOARD_SERVICE = Symbol('LeaderboardPort');
