import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
  COLUMN_PRECISION,
  MAX_POINTS,
  MONEY_SCALE,
  POINTS_SCALE,
  RATE_SCALE,
} from '../../src/common/money.js';
import { startDatabase } from './support/app.js';

/**
 * The scales the code writes with, against the scales the database stores.
 *
 * These numbers live in three places: the constants, the entity decorators —
 * which now read the constants — and the migration's raw SQL, which cannot.
 * Nothing makes them agree, and disagreeing is silent: Postgres rounds a value
 * to the column's scale on the way in without a word. Points are truncated
 * everywhere in this service on purpose, so a scale drift would introduce
 * rounding into money, in the player's favour, with no error and no test
 * failing.
 *
 * The schema-drift suite compares the entities with the database and would not
 * see it: a constant changed on its own leaves the entities and the schema in
 * perfect agreement while the code writes digits the column silently drops.
 */
let dataSource: DataSource;

beforeAll(async () => {
  dataSource = await startDatabase();
}, 120_000);

afterAll(async () => {
  await dataSource?.destroy();
});

interface NumericColumn {
  readonly numeric_precision: number;
  readonly numeric_scale: number;
}

async function columnOf(table: string, column: string): Promise<NumericColumn | undefined> {
  const [row] = await dataSource.query<NumericColumn[]>(
    `SELECT numeric_precision, numeric_scale
       FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  );

  return row;
}

describe('the numeric columns', () => {
  it.each([
    ['bets', 'stake', MONEY_SCALE],
    ['bets', 'win_amount', MONEY_SCALE],
    ['bets', 'fx_rate', RATE_SCALE],
    ['bets', 'points_awarded', POINTS_SCALE],
    ['player_scores', 'points', POINTS_SCALE],
  ])('store %s.%s at the scale the code writes', async (table, column, scale) => {
    const actual = await columnOf(table, column);

    expect(actual?.numeric_scale).toBe(scale);
    expect(actual?.numeric_precision).toBe(COLUMN_PRECISION);
  });

  it('can hold the largest points value the guard allows', async () => {
    // MAX_POINTS is what `toPoints` refuses to exceed. If it did not fit the
    // column, the guard would pass a value the database then rounds or
    // rejects — the overflow check and the column have to agree on the limit.
    const [integer, fraction] = MAX_POINTS.split('.');

    expect(fraction).toHaveLength(POINTS_SCALE);
    expect(integer).toHaveLength(COLUMN_PRECISION - POINTS_SCALE);

    // And the database agrees it is storable, which is the claim that matters.
    const [row] = await dataSource.query<{ stored: string }[]>(
      `SELECT $1::numeric(${COLUMN_PRECISION}, ${POINTS_SCALE}) AS stored`,
      [MAX_POINTS],
    );
    expect(row?.stored).toBe(MAX_POINTS);
  });
});

/**
 * That money arrives from the driver as text, never as a JavaScript number.
 *
 * This is the assumption underneath the decision to store exact decimals
 * instead of integer minor units. Storing cents is the usual advice, and the
 * reason it is good advice is binary floating point: `0.1 + 0.2` is
 * `0.30000000000000004`, and summing ten thousand `0.0001`s as doubles gives
 * `0.9999999999999062` instead of `1`. Postgres `numeric` is not a float — it
 * is exact decimal arithmetic — and `pg` hands it over as a string, so no
 * money value in this service is ever held in a double.
 *
 * All of which holds only while the driver keeps doing that. A single
 * `pg.types.setTypeParser(1700, parseFloat)` — a common way to make `numeric`
 * "nicer" to work with — would silently turn every amount, rate and points
 * value into a double, and every other test here would still pass: the numbers
 * are small in tests, and doubles are exact until they are not. Hence this.
 */
describe('money coming back from the database', () => {
  it('arrives as text, not as a double', async () => {
    const [row] = await dataSource.query<Record<string, unknown>[]>(
      `SELECT '999999999999.9999'::numeric(${COLUMN_PRECISION}, ${MONEY_SCALE}) AS amount,
              '1.00000001'::numeric(${COLUMN_PRECISION}, ${RATE_SCALE}) AS rate,
              '1000000009999.999899'::numeric(${COLUMN_PRECISION}, ${POINTS_SCALE}) AS points`,
    );

    expect(typeof row?.['amount']).toBe('string');
    expect(typeof row?.['rate']).toBe('string');
    expect(typeof row?.['points']).toBe('string');
  });

  it('keeps every digit of a value a double could not hold', async () => {
    // 1000000009999.999899 needs 19 significant digits; a double carries 15–17,
    // so a parser that produced numbers would come back changed here.
    const exact = '1000000009999.999899';

    const [row] = await dataSource.query<{ points: string }[]>(
      `SELECT $1::numeric(${COLUMN_PRECISION}, ${POINTS_SCALE})::text AS points`,
      [exact],
    );

    expect(row?.points).toBe(exact);
    // And the same value as a double does not survive, which is the point.
    expect(String(Number(exact))).not.toBe(exact);
  });

  it('stores and returns a bet amount unchanged through the real columns', async () => {
    // Not a cast in a SELECT but a round trip through the table, because the
    // column's own scale is the last place a digit can be lost.
    // This suite runs migrations only — the tournament row is the application's
    // doing on boot — so the parent row is created here.
    const tournamentId = randomUUID();
    await dataSource.query(
      `INSERT INTO tournaments (id, code, starts_at, ends_at)
       VALUES ($1, $2, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z')`,
      [tournamentId, `scales-${Date.now()}`],
    );

    const betId = randomUUID();
    await dataSource.query(
      `INSERT INTO bets (tournament_id, bet_id, player_id, status, currency, stake,
                         win_amount, fx_rate, points_awarded, settled_at)
       VALUES ($1, $2, $3, 'settled', 'USD', $4, $4, $5, $6, now())`,
      [tournamentId, betId, randomUUID(), '999999999999.9999', '1.00000001', '0.000001'],
    );

    const [stored] = await dataSource.query<Record<string, unknown>[]>(
      'SELECT stake, win_amount, fx_rate, points_awarded FROM bets WHERE bet_id = $1',
      [betId],
    );

    expect(stored).toEqual({
      stake: '999999999999.9999',
      win_amount: '999999999999.9999',
      fx_rate: '1.00000001',
      points_awarded: '0.000001',
    });
  });
});
