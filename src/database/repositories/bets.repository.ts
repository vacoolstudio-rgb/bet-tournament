import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { notImplemented } from '../../common/not-implemented.error.js';
import type { Bet } from '../entities/index.js';

/** A settled bet as it is written to the journal. */
export interface SettledBetRow {
  readonly tournamentId: string;
  readonly betId: string;
  readonly playerId: string;
  readonly currency: string;
  /** NUMERIC(20,4) as a decimal string. */
  readonly stake: string;
  readonly winAmount: string;
  /** NUMERIC(20,8) as a decimal string. */
  readonly fxRate: string;
  /** NUMERIC(20,6) as a decimal string — what this bet actually scored. */
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
  readonly pointsAwarded: string;
}

@Injectable()
export class BetsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Journals a settled bet, idempotently.
   *
   * Inserts with `ON CONFLICT` so a redelivery cannot double-credit: the
   * caller credits the aggregate only on `inserted`. A conflict against a
   * `rollback_pending` tombstone fills in the audit columns and flips the row
   * to `rolled_back` — the bet is void, but the record should still say what
   * it was.
   */
  insertSettled(_manager: EntityManager, _row: SettledBetRow): Promise<InsertSettledResult> {
    return notImplemented('BetsRepository.insertSettled', this.dataSource);
  }

  /**
   * Flips a settled bet to `rolled_back` and reports what it had scored.
   *
   * The update is conditional on the current status being `settled`, which is
   * what makes a repeated rollback subtract exactly once. Returns null when
   * there was nothing to void — the bet is unknown, or already void.
   */
  markRolledBack(
    _manager: EntityManager,
    _tournamentId: string,
    _betId: string,
  ): Promise<VoidedBet | null> {
    return notImplemented('BetsRepository.markRolledBack', this.dataSource);
  }

  /**
   * Records a rollback for a bet that has not been settled yet.
   *
   * Returns false if a row appeared concurrently, which makes two rollbacks
   * racing each other a no-op rather than a constraint violation.
   */
  insertTombstone(
    _manager: EntityManager,
    _row: { readonly tournamentId: string; readonly betId: string; readonly playerId: string },
  ): Promise<boolean> {
    return notImplemented('BetsRepository.insertTombstone', this.dataSource);
  }

  /**
   * The latest `settled_at` among the player's bets that still count towards
   * their score. This is what a rollback resets `last_scored_at` to; null means
   * the player has no scoring bets left.
   */
  latestScoringSettledAt(
    _manager: EntityManager,
    _tournamentId: string,
    _playerId: string,
  ): Promise<Date | null> {
    return notImplemented('BetsRepository.latestScoringSettledAt', this.dataSource);
  }

  /** Reads one journal row. Used by diagnostics and by the tests. */
  findOne(_tournamentId: string, _betId: string): Promise<Bet | null> {
    return notImplemented('BetsRepository.findOne', this.dataSource);
  }
}
