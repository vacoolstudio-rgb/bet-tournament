import type { Bet } from '../entities/index.js';
import type { TransactionScope } from './transaction.js';

/** Identifies a bet inside a tournament — the journal's primary key. */
export interface BetIdentity {
  readonly tournamentId: string;
  readonly betId: string;
}

/**
 * A settled bet as it is written to the journal.
 *
 * Money and points are decimal strings, matching their NUMERIC columns: a
 * `number` here would be a float, and this is money.
 */
export interface SettledBetRow extends BetIdentity {
  readonly playerId: string;
  readonly currency: string;
  /** NUMERIC(20,4). */
  readonly stake: string;
  /** NUMERIC(20,4). */
  readonly winAmount: string;
  /** NUMERIC(20,8) — the rate the points were computed with. */
  readonly fxRate: string;
  /** NUMERIC(20,6) — what this bet actually scored. */
  readonly pointsAwarded: string;
  readonly settledAt: Date;
}

/**
 * What writing a settled bet actually did.
 *
 *  - `inserted`         first time seen; the aggregate must be credited;
 *  - `duplicate`        already journalled; credit nothing;
 *  - `tombstone_filled` a rollback got here first, so the amounts were
 *                       recorded for audit but nothing is credited.
 */
export type InsertSettledResult = 'inserted' | 'duplicate' | 'tombstone_filled';

/** The bet a rollback just voided, and what it had scored. */
export interface VoidedBet {
  readonly playerId: string;
  /** NUMERIC(20,6) — subtract exactly this, never a recomputed value. */
  readonly pointsAwarded: string;
}

export interface InsertSettledBetInput {
  readonly scope: TransactionScope;
  readonly bet: SettledBetRow;
}

export interface MarkRolledBackInput extends BetIdentity {
  readonly scope: TransactionScope;
}

export interface InsertTombstoneInput extends BetIdentity {
  readonly scope: TransactionScope;
  readonly playerId: string;
}

export interface PlayerBetsQuery {
  readonly scope: TransactionScope;
  readonly tournamentId: string;
  readonly playerId: string;
}

export interface BetsRepositoryPort {
  /**
   * Journals a settled bet, idempotently. The caller credits the aggregate
   * only when the result is `inserted`.
   */
  insertSettled(input: InsertSettledBetInput): Promise<InsertSettledResult>;

  /**
   * Flips a settled bet to `rolled_back` and reports what it had scored.
   * Returns null when there was nothing to void — unknown bet, or already
   * void, which is what makes a repeated rollback subtract exactly once.
   */
  markRolledBack(input: MarkRolledBackInput): Promise<VoidedBet | null>;

  /**
   * Records a rollback for a bet that has not been settled yet. False means a
   * row appeared concurrently, so two racing rollbacks are a no-op rather than
   * a constraint violation.
   */
  insertTombstone(input: InsertTombstoneInput): Promise<boolean>;

  /**
   * Latest `settled_at` among the player's bets that still score. This is what
   * a rollback resets the tie-break key to; null means none are left.
   */
  latestScoringSettledAt(input: PlayerBetsQuery): Promise<Date | null>;

  /** Reads one journal row, outside any transaction. */
  findOne(input: BetIdentity): Promise<Bet | null>;
}

export const BETS_REPOSITORY = Symbol('BetsRepositoryPort');
