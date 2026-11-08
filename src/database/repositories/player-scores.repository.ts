import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  CreditPointsInput,
  DebitPointsInput,
  DecrementCountedInput,
  PlayerKey,
  PlayerScoreRow,
  PlayerScoresRepositoryPort,
  RankQuery,
  TopQuery,
} from '../contracts/index.js';

interface ScoreRow {
  player_id: string;
  points: string;
  bets_counted: number;
  last_scored_at: Date | null;
}

const toRow = (row: ScoreRow): PlayerScoreRow => ({
  playerId: row.player_id,
  points: row.points,
  betsCounted: row.bets_counted,
  lastScoredAt: row.last_scored_at,
});

/**
 * The canonical order of the board, written once.
 *
 * It has to match `player_scores_leaderboard_idx` character for character —
 * including `NULLS LAST`, which is the default for `ASC` and spelled out
 * anyway — or the sort stops being free and nothing says so.
 */
const LEADERBOARD_ORDER = 'points DESC, last_scored_at ASC NULLS LAST, player_id ASC';

/** Postgres adapter for {@link PlayerScoresRepositoryPort}. */
@Injectable()
export class PlayerScoresRepository implements PlayerScoresRepositoryPort {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * An upsert with an increment, never read-modify-write: two consumers
   * crediting the same player would otherwise lose an increment, and a lost
   * increment never comes back.
   *
   * `last_scored_at` moves only when the bet actually scored, or a losing bet
   * would change a player's position without changing their score. On the
   * update branch `greatest` does the rest: it ignores NULL, so a player whose
   * key was never set picks up the timestamp of their first scoring bet, and
   * an event arriving out of order cannot push the key backwards.
   */
  async credit({
    scope,
    tournamentId,
    playerId,
    points,
    settledAt,
  }: CreditPointsInput): Promise<void> {
    await scope.manager.query(
      `INSERT INTO player_scores (tournament_id, player_id, points, bets_counted, last_scored_at)
       VALUES ($1, $2, $3, 1,
               CASE WHEN $3::numeric > 0 THEN $4::timestamptz ELSE NULL END)
       ON CONFLICT (tournament_id, player_id) DO UPDATE
         SET points         = player_scores.points + excluded.points,
             bets_counted   = player_scores.bets_counted + 1,
             last_scored_at = CASE
               WHEN excluded.points > 0
                 THEN greatest(player_scores.last_scored_at, excluded.last_scored_at)
               ELSE player_scores.last_scored_at
             END,
             updated_at = now()`,
      [tournamentId, playerId, points, settledAt],
    );
  }

  async debit({
    scope,
    tournamentId,
    playerId,
    points,
    lastScoredAt,
  }: DebitPointsInput): Promise<void> {
    const rows = await scope.manager.query<unknown[]>(
      // Wrapped in a CTE so the driver returns rows rather than
      // `[rows, affectedCount]` — see BetsRepository.markRolledBack for what
      // reading that shape directly costs.
      `WITH debited AS (
         UPDATE player_scores
            SET points         = points - $3::numeric,
                bets_counted   = bets_counted - 1,
                last_scored_at = $4::timestamptz,
                updated_at     = now()
          WHERE tournament_id = $1 AND player_id = $2
          RETURNING 1 AS touched
       )
       SELECT touched FROM debited`,
      [tournamentId, playerId, points, lastScoredAt],
    );

    // Unreachable on any path — a bet is only voided after it was credited,
    // and crediting creates the row. If it ever happens the journal and the
    // aggregate have drifted, and a silent no-op would keep points that no bet
    // accounts for.
    if (rows.length === 0) {
      throw new Error(
        `No aggregate row for player ${playerId} in tournament ${tournamentId}: ` +
          `the bet journal and the leaderboard have diverged`,
      );
    }
  }

  async decrementCounted({ scope, tournamentId, playerId }: DecrementCountedInput): Promise<void> {
    const rows = await scope.manager.query<unknown[]>(
      `WITH counted AS (
         UPDATE player_scores
            SET bets_counted = bets_counted - 1, updated_at = now()
          WHERE tournament_id = $1 AND player_id = $2
          RETURNING 1 AS touched
       )
       SELECT touched FROM counted`,
      [tournamentId, playerId],
    );

    if (rows.length === 0) {
      throw new Error(
        `No aggregate row for player ${playerId} in tournament ${tournamentId}: ` +
          `the bet journal and the leaderboard have diverged`,
      );
    }
  }

  async top({ tournamentId, limit }: TopQuery): Promise<PlayerScoreRow[]> {
    const rows = await this.dataSource.query<ScoreRow[]>(
      `SELECT player_id, points, bets_counted, last_scored_at
         FROM player_scores
        WHERE tournament_id = $1
        ORDER BY ${LEADERBOARD_ORDER}
        LIMIT $2`,
      [tournamentId, limit],
    );

    return rows.map(toRow);
  }

  async findOne({ tournamentId, playerId }: PlayerKey): Promise<PlayerScoreRow | null> {
    const rows = await this.dataSource.query<ScoreRow[]>(
      `SELECT player_id, points, bets_counted, last_scored_at
         FROM player_scores
        WHERE tournament_id = $1 AND player_id = $2`,
      [tournamentId, playerId],
    );
    const row = rows[0];

    return row === undefined ? null : toRow(row);
  }

  /**
   * "How many sort strictly above this row", which is the same thing as its
   * position, expressed as the lexicographic comparison the index is built on.
   *
   * The NULL case needs no handling: a row with points cannot have a NULL key
   * (`player_scores_scored_has_key` sees to that), and a row without points is
   * never ranked.
   *
   * Measured on 50 000 players: 0.06 ms near the top, where the index cuts
   * almost everything, and about 6 ms in the middle, where Postgres rightly
   * switches to a sequential scan — still several times cheaper than numbering
   * the whole table with a window function to read one row of it.
   */
  async rankOf({ tournamentId, row }: RankQuery): Promise<number> {
    const rows = await this.dataSource.query<{ rank: string }[]>(
      `SELECT count(*) + 1 AS rank
         FROM player_scores
        WHERE tournament_id = $1
          AND ( points > $2::numeric
             OR ( points = $2::numeric
                  AND ( last_scored_at < $3::timestamptz
                     OR ( last_scored_at = $3::timestamptz AND player_id < $4::uuid ))))`,
      [tournamentId, row.points, row.lastScoredAt, row.playerId],
    );

    return Number(rows[0]?.rank ?? 1);
  }
}
