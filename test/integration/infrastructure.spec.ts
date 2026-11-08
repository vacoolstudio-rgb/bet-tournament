import type { DataSource } from 'typeorm';
import { inject } from 'vitest';
import { createDataSource } from '../../src/database/data-source.js';
import { fakeConfig } from '../support/fakes.js';

/**
 * Proves the harness and the migration, not the application.
 *
 * It is the first thing to look at when an integration run goes strange: if
 * this file is red, nothing downstream means anything.
 */
let dataSource: DataSource;

beforeAll(async () => {
  dataSource = createDataSource(fakeConfig({ databaseUrl: inject('databaseUrl') }));
  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'each' });
}, 120_000);

afterAll(async () => {
  await dataSource?.destroy();
});

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return dataSource.query<T[]>(sql, params);
}

const TOURNAMENT = '11111111-1111-4111-8111-111111111111';
const PLAYER = '33333333-3333-4333-8333-333333333333';

beforeEach(async () => {
  await dataSource.query('TRUNCATE player_scores, bets, tournaments CASCADE');
  await dataSource.query(
    `INSERT INTO tournaments (id, code, starts_at, ends_at)
     VALUES ($1, 'nov-2026', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z')`,
    [TOURNAMENT],
  );
});

describe('the migration', () => {
  it('creates the three tables', async () => {
    const tables = await rows<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> 'migrations' ORDER BY table_name`,
    );

    expect(tables.map((row) => row.table_name)).toEqual(['bets', 'player_scores', 'tournaments']);
  });

  it('indexes the leaderboard in exactly the order the query asks for', async () => {
    // If the index and the ORDER BY disagree — including on NULLS LAST — the
    // sort stops being free and nothing says so.
    const [index] = await rows<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'player_scores_leaderboard_idx'`,
    );

    expect(index?.indexdef).toContain('points DESC');
    expect(index?.indexdef).toContain('last_scored_at');
    expect(index?.indexdef).toContain('player_id');
  });

  it('keeps the scoring index partial, so rollbacks scan only what counts', async () => {
    const [index] = await rows<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'bets_scoring_by_player_idx'`,
    );

    expect(index?.indexdef).toContain('WHERE');
    expect(index?.indexdef).toContain("status = 'settled'");
    expect(index?.indexdef).toContain('points_awarded > ');
  });
});

describe('the bets constraints', () => {
  const insert = (columns: string, values: string, params: unknown[] = []) =>
    dataSource.query(`INSERT INTO bets (${columns}) VALUES (${values})`, params);

  it('accepts a settled bet with every amount present', async () => {
    await expect(
      insert(
        `tournament_id, bet_id, player_id, status, currency, stake, win_amount, fx_rate,
         points_awarded, settled_at`,
        `$1, gen_random_uuid(), $2, 'settled', 'EUR', 10, 10.4, 1.08, 11.232,
         '2026-11-15T10:00:00Z'`,
        [TOURNAMENT, PLAYER],
      ),
    ).resolves.toBeDefined();
  });

  it('accepts a tombstone that knows nothing but the identity', async () => {
    // The row an early rollback writes: no currency, no amounts, no timestamp.
    await expect(
      insert(
        `tournament_id, bet_id, player_id, status`,
        `$1, gen_random_uuid(), $2, 'rollback_pending'`,
        [TOURNAMENT, PLAYER],
      ),
    ).resolves.toBeDefined();
  });

  it('refuses a settled bet with missing amounts', async () => {
    await expect(
      insert(`tournament_id, bet_id, player_id, status`, `$1, gen_random_uuid(), $2, 'settled'`, [
        TOURNAMENT,
        PLAYER,
      ]),
    ).rejects.toThrow(/bets_settled_has_amounts/);
  });

  it('refuses a tombstone that claims points', async () => {
    await expect(
      insert(
        `tournament_id, bet_id, player_id, status, points_awarded`,
        `$1, gen_random_uuid(), $2, 'rollback_pending', 5`,
        [TOURNAMENT, PLAYER],
      ),
    ).rejects.toThrow(/bets_tombstone_scores_nothing/);
  });

  it('refuses an unknown status', async () => {
    // Everything else about the row is valid, so the status constraint is the
    // only one that can object.
    await expect(
      insert(
        `tournament_id, bet_id, player_id, status, currency, stake, win_amount, fx_rate,
         settled_at`,
        `$1, gen_random_uuid(), $2, 'cashed_out', 'EUR', 10, 10.4, 1.08, now()`,
        [TOURNAMENT, PLAYER],
      ),
    ).rejects.toThrow(/bets_status_known/);
  });

  it('refuses a negative amount and a non-positive rate', async () => {
    await expect(
      insert(
        `tournament_id, bet_id, player_id, status, currency, stake, win_amount, fx_rate,
         settled_at`,
        `$1, gen_random_uuid(), $2, 'settled', 'EUR', -1, 0, 1.08, now()`,
        [TOURNAMENT, PLAYER],
      ),
    ).rejects.toThrow(/bets_amounts_non_negative/);

    await expect(
      insert(
        `tournament_id, bet_id, player_id, status, currency, stake, win_amount, fx_rate,
         settled_at`,
        `$1, gen_random_uuid(), $2, 'settled', 'EUR', 1, 0, 0, now()`,
        [TOURNAMENT, PLAYER],
      ),
    ).rejects.toThrow(/bets_amounts_non_negative/);
  });

  it('stores a ten-character currency code', async () => {
    // USDT and MATIC are as real here as EUR.
    await insert(
      `tournament_id, bet_id, player_id, status, currency, stake, win_amount, fx_rate,
       settled_at`,
      `$1, gen_random_uuid(), $2, 'settled', 'MATIC', 1, 1, 0.41, now()`,
      [TOURNAMENT, PLAYER],
    );

    const [bet] = await rows<{ currency: string }>(`SELECT currency FROM bets`);
    expect(bet?.currency).toBe('MATIC');
  });

  it('keeps one bet per tournament, which is what makes a redelivery harmless', async () => {
    const betId = '22222222-2222-4222-8222-222222222222';
    const values = `$1, $2, $3, 'settled', 'EUR', 10, 10.4, 1.08, 11.232, now()`;
    const columns = `tournament_id, bet_id, player_id, status, currency, stake, win_amount,
       fx_rate, points_awarded, settled_at`;

    await insert(columns, values, [TOURNAMENT, betId, PLAYER]);

    await expect(insert(columns, values, [TOURNAMENT, betId, PLAYER])).rejects.toThrow(/bets_pkey/);
  });
});

describe('the player_scores constraints', () => {
  const insert = (columns: string, values: string, params: unknown[] = []) =>
    dataSource.query(`INSERT INTO player_scores (${columns}) VALUES (${values})`, params);

  it('accepts a player who has never scored, with no tie-break key', async () => {
    await expect(
      insert(
        `tournament_id, player_id, points, bets_counted, last_scored_at`,
        `$1, $2, 0, 1, NULL`,
        [TOURNAMENT, PLAYER],
      ),
    ).resolves.toBeDefined();
  });

  it('refuses points without a tie-break key', async () => {
    // The two are written together or the ordering key is a lie.
    await expect(
      insert(
        `tournament_id, player_id, points, bets_counted, last_scored_at`,
        `$1, $2, 11.232, 1, NULL`,
        [TOURNAMENT, PLAYER],
      ),
    ).rejects.toThrow(/player_scores_scored_has_key/);
  });

  it('refuses a negative score and a negative tally', async () => {
    await expect(
      insert(
        `tournament_id, player_id, points, bets_counted, last_scored_at`,
        `$1, $2, -1, 0, now()`,
        [TOURNAMENT, PLAYER],
      ),
    ).rejects.toThrow(/player_scores_points_non_negative/);

    await expect(
      insert(
        `tournament_id, player_id, points, bets_counted, last_scored_at`,
        `$1, $2, 0, -1, now()`,
        [TOURNAMENT, PLAYER],
      ),
    ).rejects.toThrow(/player_scores_bets_non_negative/);
  });

  it('keeps six decimal places, so no fraction of a point is lost on write', async () => {
    await insert(
      `tournament_id, player_id, points, bets_counted, last_scored_at`,
      `$1, $2, 0.000001, 1, now()`,
      [TOURNAMENT, PLAYER],
    );

    const [score] = await rows<{ points: string }>(`SELECT points FROM player_scores`);
    expect(score?.points).toBe('0.000001');
  });
});

describe('the tournaments constraints', () => {
  it('refuses a window that ends before it starts', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO tournaments (id, code, starts_at, ends_at)
         VALUES (gen_random_uuid(), 'broken', '2026-12-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
      ),
    ).rejects.toThrow(/tournaments_window_ordered/);
  });

  it('keeps codes unique, so the boot-time upsert has something to match on', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO tournaments (id, code, starts_at, ends_at)
         VALUES (gen_random_uuid(), 'nov-2026', '2027-01-01T00:00:00Z', '2027-02-01T00:00:00Z')`,
      ),
    ).rejects.toThrow(/tournaments_code_key/);
  });
});
