import { DataSource } from 'typeorm';
import { createDataSourceOptions } from '../../src/database/data-source.js';
import { TypeOrmUnitOfWork } from '../../src/database/unit-of-work.js';
import { testConfig } from './support/app.js';

/**
 * The isolation level the domain depends on, asked for rather than inherited.
 *
 * A rollback that arrives alongside its own settle takes the points off only
 * because of a read-committed detail: its tombstone insert conflicts, and the
 * statement after the conflict sees a fresh snapshot and debits. Under
 * repeatable read the insert raises `could not serialize access due to
 * concurrent update`, the transaction aborts, and the bet stays `settled`.
 *
 * `default_transaction_isolation` is a database and a role setting, so without
 * an explicit level this invariant would hold or not depending on how the
 * server happens to be configured — and nothing in the project would say so.
 * The connection here is deliberately configured the wrong way to prove the
 * code does not care.
 */
let hostile: DataSource;

beforeAll(async () => {
  hostile = new DataSource({
    ...createDataSourceOptions(testConfig()),
    // Server-side default for this connection, the way a DBA would set it on
    // the database or the role.
    // The space is escaped because libpq splits `options` on whitespace: the
    // unescaped form arrives as the value "repeatable" and the server rejects
    // the connection.
    extra: { max: 2, options: String.raw`-c default_transaction_isolation=repeatable\ read` },
  });
  await hostile.initialize();
}, 120_000);

afterAll(async () => {
  await hostile?.destroy();
});

describe('a transaction opened by the unit of work', () => {
  it('runs at read committed even when the server default is not', async () => {
    // Guard against the connection silently ignoring `options`, which would
    // make the real assertion below vacuous.
    const [session] = await hostile.query<{ setting: string }[]>(
      "SELECT current_setting('default_transaction_isolation') AS setting",
    );
    expect(session?.setting).toBe('repeatable read');

    const unitOfWork = new TypeOrmUnitOfWork(hostile);

    const level = await unitOfWork.withTransaction(async (scope) => {
      const [row] = await scope.manager.query<{ transaction_isolation: string }[]>(
        'SHOW transaction_isolation',
      );

      return row?.transaction_isolation;
    });

    expect(level).toBe('read committed');
  });

  it('commits on return and rolls back on throw', async () => {
    // The other half of the port's promise, on the same connection: an
    // isolation level is no use if the transaction boundary is wrong.
    const unitOfWork = new TypeOrmUnitOfWork(hostile);
    const probe = `iso_probe_${Date.now()}`;

    await unitOfWork.withTransaction(async (scope) => {
      await scope.manager.query(`CREATE TEMP TABLE ${probe} (n int)`);
      await scope.manager.query(`INSERT INTO ${probe} VALUES (1)`);
    });

    await expect(
      unitOfWork.withTransaction(async (scope) => {
        await scope.manager.query(`INSERT INTO ${probe} VALUES (2)`);
        throw new Error('give it back');
      }),
    ).rejects.toThrow('give it back');

    const rows = await hostile.query<{ n: number }[]>(`SELECT n FROM ${probe} ORDER BY n`);
    expect(rows.map((row) => row.n)).toEqual([1]);
  });
});
