import type { TransactionScope } from './transaction.js';

/** One row of the leaderboard aggregate, with NUMERIC columns as strings. */
export interface PlayerScoreRow {
  readonly playerId: string;
  /** NUMERIC(20,6) — exact points. */
  readonly points: string;
  readonly betsCounted: number;
  /** Null when the player has never scored; see the entity for why. */
  readonly lastScoredAt: Date | null;
}

export interface PlayerKey {
  readonly tournamentId: string;
  readonly playerId: string;
}

export interface CreditPointsInput extends PlayerKey {
  readonly scope: TransactionScope;
  /** NUMERIC(20,6); "0" for a losing bet, which still counts as a bet. */
  readonly points: string;
  /** The bet's `settledAt`. Only moves the tie-break key when points > 0. */
  readonly settledAt: Date;
}

export interface DebitPointsInput extends PlayerKey {
  readonly scope: TransactionScope;
  /** Exactly what the voided bet had scored. */
  readonly points: string;
  /**
   * Recomputed tie-break key: the latest `settled_at` among the bets that
   * still score, or null when none are left. Assigned, not coalesced — a
   * player whose last scoring bet was just voided has not scored.
   */
  readonly lastScoredAt: Date | null;
}

export interface DecrementCountedInput extends PlayerKey {
  readonly scope: TransactionScope;
}

export interface TopQuery {
  readonly tournamentId: string;
  readonly limit: number;
}

export interface RankQuery {
  readonly tournamentId: string;
  /** The row whose position is wanted; it carries the whole sort key. */
  readonly row: PlayerScoreRow;
}

export interface PlayerScoresRepositoryPort {
  /**
   * Credits a settled bet. One atomic upsert with an increment, never
   * read-modify-write: two consumers touching the same player would otherwise
   * lose an increment, and a lost increment never comes back.
   */
  credit(input: CreditPointsInput): Promise<void>;

  /**
   * Debits a voided bet and resets the tie-break key.
   *
   * @throws Error when no aggregate row was updated. That cannot happen on any
   *         path — a bet can only be voided after it was credited — so if it
   *         ever does, the aggregate and the journal have drifted apart and
   *         continuing would quietly keep points that no bet accounts for.
   */
  debit(input: DebitPointsInput): Promise<void>;

  /** Drops the counted-bets tally alone — a voided losing bet. */
  decrementCounted(input: DecrementCountedInput): Promise<void>;

  /**
   * Top `limit` players in the canonical order, counting only those with
   * points: a tournament has no position for someone who has not scored in it,
   * and the ranking predicate never counts them either.
   */
  top(query: TopQuery): Promise<PlayerScoreRow[]>;

  findOne(key: PlayerKey): Promise<PlayerScoreRow | null>;

  /**
   * 1-based position of a row in that same order, counted as "how many sort
   * strictly above it" rather than by numbering the whole table.
   *
   * Only meaningful for a row with points: the caller must not ask for the
   * position of a zero-points player, because a tournament has no position for
   * someone who has not scored in it.
   */
  rankOf(query: RankQuery): Promise<number>;
}

export const PLAYER_SCORES_REPOSITORY = Symbol('PlayerScoresRepositoryPort');
