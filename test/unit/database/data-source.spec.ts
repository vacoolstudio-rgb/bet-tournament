import { createDataSourceOptions } from '../../../src/database/data-source.js';
import { fakeConfig } from '../../support/fakes.js';

/**
 * The options that decide who owns the schema.
 *
 * `synchronize: true` is the default in many TypeORM setups and it is a
 * one-word change away. It would make the entities the source of truth at
 * runtime: a renamed column becomes a dropped column, a narrowed type becomes
 * silent data loss, and the migrations — which the schema-drift suite treats as
 * authoritative — become decoration. Nothing else in the project would notice
 * until the first boot against a database that has data in it.
 */
describe('the data source options', () => {
  it('never let TypeORM touch the schema', () => {
    const options = createDataSourceOptions(fakeConfig());

    expect(options.synchronize).toBe(false);
    // The second half of the same decision: migrations run from the CLI and
    // from the one-shot compose service, where a failure is visible and
    // ordered — not from inside a booting replica racing two others.
    expect(options.migrationsRun).toBe(false);
  });

  it('size the pool from the config rather than the driver default', () => {
    // The driver's ten has nothing to do with how many handlers can be
    // mid-transaction; AppConfig ties it to the prefetch.
    const options = createDataSourceOptions(fakeConfig({ databasePoolMax: 42 }));

    expect(options.extra).toMatchObject({ max: 42 });
  });
});
