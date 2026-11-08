import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  TournamentCodeQuery,
  TournamentRecord,
  TournamentsRepositoryPort,
  TournamentWindow,
} from '../contracts/index.js';

interface TournamentRow {
  id: string;
  code: string;
  starts_at: Date;
  ends_at: Date;
  created_at: Date;
}

const toRecord = (row: TournamentRow): TournamentRecord => ({
  id: row.id,
  code: row.code,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  createdAt: row.created_at,
});

/** Postgres adapter for {@link TournamentsRepositoryPort}. */
@Injectable()
export class TournamentsRepository implements TournamentsRepositoryPort {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Runs on every boot, so it has to be idempotent and it has to keep the id:
   * the conflict branch updates the window in place rather than creating a
   * second row, and everything already scored keeps pointing at the same
   * tournament.
   */
  async upsertByCode({ code, startsAt, endsAt }: TournamentWindow): Promise<TournamentRecord> {
    const rows = await this.dataSource.query<TournamentRow[]>(
      `INSERT INTO tournaments (id, code, starts_at, ends_at)
       VALUES (gen_random_uuid(), $1, $2, $3)
       ON CONFLICT (code) DO UPDATE
         SET starts_at = excluded.starts_at, ends_at = excluded.ends_at
       RETURNING *`,
      [code, startsAt, endsAt],
    );
    const row = rows[0];

    if (row === undefined) {
      throw new Error(`Upserting tournament "${code}" returned no row`);
    }

    return toRecord(row);
  }

  async findByCode({ code }: TournamentCodeQuery): Promise<TournamentRecord | null> {
    const rows = await this.dataSource.query<TournamentRow[]>(
      `SELECT * FROM tournaments WHERE code = $1`,
      [code],
    );
    const row = rows[0];

    return row === undefined ? null : toRecord(row);
  }
}
