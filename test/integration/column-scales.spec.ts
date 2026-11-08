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
