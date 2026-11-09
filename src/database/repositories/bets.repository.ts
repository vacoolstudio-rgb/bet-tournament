import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  BetIdentity,
  BetRecord,
  BetsRepositoryPort,
  InsertSettledBetInput,
  InsertSettledResult,
  InsertTombstoneInput,
  MarkRolledBackInput,
  PlayerBetsQuery,
  VoidedBet,
} from '../contracts/index.js';
import type { BetStatus } from '../entities/index.js';

interface BetRow {
  tournament_id: string;
  bet_id: string;
  player_id: string;
  status: BetStatus;
  currency: string | null;
  stake: string | null;
  win_amount: string | null;
  fx_rate: string | null;
  points_awarded: string;
  settled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Postgres adapter for {@link BetsRepositoryPort}. */
@Injectable()
export class BetsRepository implements BetsRepositoryPort {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * One statement, three outcomes, told apart by the status it returns.
   *
   * A clean insert always writes `settled`; the conflict branch only fires for
   * a tombstone and always writes `rolled_back`; a conflict with any other
   * status fails the `WHERE` and returns no row at all. That makes the result
   * readable without the `xmax = 0` trick and its caveats.
   */
  async insertSettled({ scope, bet }: InsertSettledBetInput): Promise<InsertSettledResult> {
    const rows = await scope.manager.query<{ status: BetStatus }[]>(
      `INSERT INTO bets (tournament_id, bet_id, player_id, status, currency, stake,
                         win_amount, fx_rate, points_awarded, settled_at)
       VALUES ($1, $2, $3, 'settled', $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tournament_id, bet_id) DO UPDATE
         SET currency   = excluded.currency,
             stake      = excluded.stake,
             win_amount = excluded.win_amount,
             fx_rate    = excluded.fx_rate,
             settled_at = excluded.settled_at,
             status     = 'rolled_back',
             updated_at = now()
         WHERE bets.status = 'rollback_pending'
       RETURNING status`,
      [
        bet.tournamentId,
        bet.betId,
        bet.playerId,
        bet.currency,
        bet.stake,
        bet.winAmount,
        bet.fxRate,
        bet.pointsAwarded,
        bet.settledAt,
      ],
    );

    if (rows.length === 0) return 'duplicate';

    return rows[0]?.status === 'settled' ? 'inserted' : 'tombstone_filled';
  }

  /**
   * The `status = 'settled'` condition is what makes a repeated rollback
   * subtract once: the second attempt waits on the row lock, re-reads the
   * status and matches nothing.
   *
   * * TypeORM hands back `[rows, affectedCount]` for a bare `UPDATE … RETURNING`
   * but a plain array of rows for a `SELECT`, so every modifying statement whose
   * rows are actually read is wrapped in a CTE and selected from.
   *
   * Not a stylistic preference: read directly, `rows[0]` is the rows *array*,
   * every field on it is undefined and `rows.length` is 2 even when nothing
   * matched. A `markRolledBack` written that way never reports "nothing to void",
   * so a repeated rollback debits twice, and `debit`'s divergence check never
   * fires. The shape was verified against the driver rather than assumed.
   */
  async markRolledBack({
    scope,
    tournamentId,
    betId,
  }: MarkRolledBackInput): Promise<VoidedBet | null> {
    const rows = await scope.manager.query<{ player_id: string; points_awarded: string }[]>(
      `WITH voided AS (
         UPDATE bets
            SET status = 'rolled_back', updated_at = now()
          WHERE tournament_id = $1 AND bet_id = $2 AND status = 'settled'
          RETURNING player_id, points_awarded
       )
       SELECT player_id, points_awarded FROM voided`,
      [tournamentId, betId],
    );

    const row = rows[0];

    return row === undefined
      ? null
      : { playerId: row.player_id, pointsAwarded: row.points_awarded };
  }

  async insertTombstone({
    scope,
    tournamentId,
    betId,
    playerId,
  }: InsertTombstoneInput): Promise<boolean> {
    const rows = await scope.manager.query<unknown[]>(
      `INSERT INTO bets (tournament_id, bet_id, player_id, status)
       VALUES ($1, $2, $3, 'rollback_pending')
       ON CONFLICT (tournament_id, bet_id) DO NOTHING
       RETURNING 1`,
      [tournamentId, betId, playerId],
    );

    return rows.length > 0;
  }

  /** Served by the partial index on (tournament, player, settled_at desc). */
  async latestScoringSettledAt({
    scope,
    tournamentId,
    playerId,
  }: PlayerBetsQuery): Promise<Date | null> {
    const rows = await scope.manager.query<{ latest: Date | null }[]>(
      `SELECT max(settled_at) AS latest
         FROM bets
        WHERE tournament_id = $1 AND player_id = $2
          AND status = 'settled' AND points_awarded > 0`,
      [tournamentId, playerId],
    );

    return rows[0]?.latest ?? null;
  }

  async findOne({ tournamentId, betId }: BetIdentity): Promise<BetRecord | null> {
    const rows = await this.dataSource.query<BetRow[]>(
      `SELECT * FROM bets WHERE tournament_id = $1 AND bet_id = $2`,
      [tournamentId, betId],
    );
    const row = rows[0];

    return row === undefined ? null : this.toRecord(row);
  }

  /** The journal row as the domain reads it; the money columns stay text. */
  private toRecord(row: BetRow): BetRecord {
    return {
      tournamentId: row.tournament_id,
      betId: row.bet_id,
      playerId: row.player_id,
      status: row.status,
      currency: row.currency,
      stake: row.stake,
      winAmount: row.win_amount,
      fxRate: row.fx_rate,
      pointsAwarded: row.points_awarded,
      settledAt: row.settled_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
