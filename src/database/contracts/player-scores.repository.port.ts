import type { TransactionScope } from './transaction.js';

/** One row of the leaderboard aggregate, with NUMERIC columns as strings. */
export interface PlayerScoreRow {
  readonly playerId: string;
  /** NUMERIC(20,6) — exact points. */
  readonly points: string;
  readonly betsCounted: number;
  readonly lastScoredAt: Date;
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
  /** Recomputed tie-break key, or null to leave the current value alone. */
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

  /** Debits a voided bet and resets the tie-break key. */
  debit(input: DebitPointsInput): Promise<void>;

  /** Drops the counted-bets tally alone — a voided losing bet. */
  decrementCounted(input: DecrementCountedInput): Promise<void>;

  /** Top `limit` players in the canonical order. */
  top(query: TopQuery): Promise<PlayerScoreRow[]>;

  findOne(key: PlayerKey): Promise<PlayerScoreRow | null>;

  /**
   * 1-based position of a row in that same order, counted as "how many sort
   * strictly above it" rather than by numbering the whole table.
   */
  rankOf(query: RankQuery): Promise<number>;
}

export const PLAYER_SCORES_REPOSITORY = Symbol('PlayerScoresRepositoryPort');
