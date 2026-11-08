import type { Decimal } from 'decimal.js';

/**
 * Domain input and output for scoring.
 *
 * One rule runs through these types: **what enters the domain is already
 * parsed** (`Decimal`, `Date`), and **what leaves it is text** (exact decimal
 * strings) because it goes on to logs, metrics and HTTP. The transport layer
 * does the converting, so no service has to re-decide what `"12.3400"` means.
 */

/** A validated, normalised `bet.settled`. */
export interface SettleBetCommand {
  readonly betId: string;
  readonly playerId: string;
  readonly currency: string;
  /** Audit only; not part of the score. */
  readonly stake: Decimal;
  readonly winAmount: Decimal;
  readonly settledAt: Date;
}

/**
 * A validated `bet.rollback` — identity only.
 *
 * The narrowness is the point: with no currency and no timestamp in the
 * command, the two ways a rollback could silently leave points credited (an
 * FX lookup that parks it, a window check that skips it) are not expressible
 * in the scoring service at all.
 */
export interface RollbackBetCommand {
  readonly betId: string;
  readonly playerId: string;
}

/** What a `bet.settled` event did. */
export type SettleOutcome =
  | { readonly status: 'scored'; readonly pointsAwarded: string }
  /** A losing bet: journalled for idempotency and rollback, worth no points. */
  | { readonly status: 'scored_zero' }
  /** Already journalled — a redelivery. */
  | { readonly status: 'duplicate' }
  /** A rollback got here first; audit columns filled, nothing scored. */
  | { readonly status: 'already_rolled_back' }
  /** `settledAt` falls outside the tournament window. */
  | { readonly status: 'out_of_window' };

/** What a `bet.rollback` event did. */
export type RollbackOutcome =
  | { readonly status: 'rolled_back'; readonly pointsRemoved: string }
  /** Not settled yet; a tombstone now blocks its scoring. */
  | { readonly status: 'tombstoned' }
  /** Already void — a redelivery or a second rollback. */
  | { readonly status: 'duplicate' };

export interface ScoringPort {
  settle(command: SettleBetCommand): Promise<SettleOutcome>;
  rollback(command: RollbackBetCommand): Promise<RollbackOutcome>;
}

export const SCORING_SERVICE = Symbol('ScoringPort');

export interface ConvertToUsdInput {
  readonly amount: Decimal;
  readonly currency: string;
}

export interface FxPort {
  /**
   * Units of USD per 1 unit of the currency. USD is 1 by definition and never
   * read from config.
   *
   * @throws UnknownCurrencyError when no rate is configured — scoring the bet
   *         as zero would make a player's winnings vanish without a trace.
   */
  rateFor(currency: string): Decimal;
  toUsd(input: ConvertToUsdInput): Decimal;
}

export const FX_SERVICE = Symbol('FxPort');

export interface ActiveTournament {
  readonly id: string;
  readonly code: string;
  /** Inclusive. */
  readonly startsAt: Date;
  /** Exclusive. */
  readonly endsAt: Date;
}

export interface TournamentPort {
  /** @throws Error before the module has finished initialising. */
  getActive(): ActiveTournament;

  /**
   * Whether a settled bet counts. `startsAt` inclusive, `endsAt` exclusive,
   * so two adjacent tournaments cannot both count the same bet.
   *
   * Only ever consulted for `bet.settled`.
   */
  isWithinWindow(settledAt: Date): boolean;
}

export const TOURNAMENT_SERVICE = Symbol('TournamentPort');
