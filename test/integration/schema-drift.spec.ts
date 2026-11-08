import type { DataSource } from 'typeorm';
import { startDatabase } from './support/app.js';

/**
 * Keeps the entities and the migrated schema from drifting apart.
 *
 * `synchronize` is off and the migrations are the source of truth, so TypeORM
 * never reconciles the two by itself — which means an entity can gain a column
 * that no migration ever created, and nothing notices until an insert fails in
 * production.
 *
 * This asks TypeORM what it *would* change to make the database match the
 * entities, and allows exactly the divergence that is deliberate. Anything else
 * is a mapping and a schema that disagree.
 */
let dataSource: DataSource;

beforeAll(async () => {
  dataSource = await startDatabase();
}, 120_000);

afterAll(async () => {
  await dataSource?.destroy();
});

/**
 * What the entities deliberately do not declare.
 *
 * All of it protects the data rather than describing it, and all of it would be
 * dropped by a generated migration applied without reading it — which is the
 * hazard this test exists to make visible:
 *
 *  - the CHECK constraints are the invariants of the domain, written where the
 *    database can enforce them. `@Check()` would let TypeORM manage them, at
 *    the cost of the same SQL living in two files;
 *  - `bets_scoring_by_player_idx` is partial, and it is the whole cost of
 *    recomputing the tie-break key on rollback;
 *  - `player_scores_leaderboard_idx` is partial too and carries the exact
 *    ordering of the board, `NULLS LAST` included;
 *  - the foreign keys exist because a bet without its tournament is garbage,
 *    and the entities model no relations on purpose — a bet is addressed by its
 *    composite key, never navigated to from a tournament.
 */
const DELIBERATELY_NOT_IN_ENTITIES = [
  'bets_tournament_id_fkey',
  'player_scores_tournament_id_fkey',
  'bets_scoring_by_player_idx',
  'player_scores_leaderboard_idx',
  'bets_status_known',
  'bets_tombstone_scores_nothing',
  'bets_settled_has_amounts',
  'bets_amounts_non_negative',
  'player_scores_points_non_negative',
  'player_scores_bets_non_negative',
  'player_scores_scored_has_key',
  'tournaments_window_ordered',
];

/** A pending change is expected only if it drops one of the above. */
function isExpected(query: string): boolean {
  const normalised = query.replace(/\s+/g, ' ');
  const drops = /DROP (CONSTRAINT|INDEX)/.test(normalised);

  return drops && DELIBERATELY_NOT_IN_ENTITIES.some((name) => normalised.includes(name));
}

describe('the entities and the migrated schema', () => {
  it('agree on every column, type and nullability', async () => {
    const pending = await dataSource.driver.createSchemaBuilder().log();
    const unexpected = pending.upQueries
      .map((query) => query.query.replace(/\s+/g, ' '))
      .filter((query) => !isExpected(query));

    // A column added to an entity without a migration shows up here as an
    // ALTER TABLE … ADD, which is exactly the bug this catches: nothing else
    // in the project would notice until an insert failed.
    expect(unexpected).toEqual([]);
  });

  it('diverge only in what protects the data, and in all of it', async () => {
    // The other direction: if a CHECK or an index stops being reported, it has
    // been dropped from the database, and the invariant it enforced is gone.
    const pending = await dataSource.driver.createSchemaBuilder().log();
    const reported = pending.upQueries.map((query) => query.query.replace(/\s+/g, ' ')).join(' ');

    for (const name of DELIBERATELY_NOT_IN_ENTITIES) {
      expect(reported, `${name} is no longer in the database`).toContain(name);
    }
  });
});
