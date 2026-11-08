import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { notImplemented } from '../../common/not-implemented.error.js';

/** One row of the leaderboard, with NUMERIC columns kept as strings. */
export interface PlayerScoreRow {
  readonly playerId: string;
  readonly points: string;
  readonly betsCounted: number;
  readonly lastScoredAt: Date;
}

export interface CreditPoints {
  readonly tournamentId: string;
  readonly playerId: string;
  /** NUMERIC(20,6) decimal string; may be "0" for a losing bet. */
  readonly points: string;
  /** The bet's `settledAt`; only moves `last_scored_at` when points > 0. */
  readonly settledAt: Date;
}

export interface DebitPoints {
  readonly tournamentId: string;
  readonly playerId: string;
  /** Exactly what the voided bet had scored. */
  readonly points: string;
  /** Recomputed tie-break key, or null to leave the current value alone. */
  readonly lastScoredAt: Date | null;
}

@Injectable()
export class PlayerScoresRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Credits a settled bet to the aggregate.
   *
   * A single `INSERT … ON CONFLICT DO UPDATE SET points = points + excluded`
   * on purpose: read-modify-write in the application would lose increments
   * whenever two consumers touch the same player, and no amount of retrying
   * brings a lost increment back.
   */
  credit(_manager: EntityManager, _input: CreditPoints): Promise<void> {
    return notImplemented('PlayerScoresRepository.credit', this.dataSource);
  }

  /**
   * Debits a voided bet from the aggregate and resets the tie-break key.
   *
   * Only ever called for a bet that was in `settled`, so the subtraction can
   * never drive the score below zero.
   */
  debit(_manager: EntityManager, _input: DebitPoints): Promise<void> {
    return notImplemented('PlayerScoresRepository.debit', this.dataSource);
  }

  /** Drops the counted-bets tally without touching points (a voided losing bet). */
  decrementCounted(
    _manager: EntityManager,
    _tournamentId: string,
    _playerId: string,
  ): Promise<void> {
    return notImplemented('PlayerScoresRepository.decrementCounted', this.dataSource);
  }

  /**
   * The top `limit` players in the tournament's canonical order:
   * points desc, then who reached the score first, then player id.
   */
  top(_tournamentId: string, _limit: number): Promise<PlayerScoreRow[]> {
    return notImplemented('PlayerScoresRepository.top', this.dataSource);
  }

  findOne(_tournamentId: string, _playerId: string): Promise<PlayerScoreRow | null> {
    return notImplemented('PlayerScoresRepository.findOne', this.dataSource);
  }

  /**
   * 1-based position of a row in that same order.
   *
   * Counts the players that sort strictly above the row rather than numbering
   * the whole table with a window function: a `ROW_NUMBER()` over every player
   * is a full pass to answer one question.
   */
  rankOf(_tournamentId: string, _row: PlayerScoreRow): Promise<number> {
    return notImplemented('PlayerScoresRepository.rankOf', this.dataSource);
  }
}
