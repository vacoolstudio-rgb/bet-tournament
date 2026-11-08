/**
 * Migration runner for local work.
 *
 *   npm run db:migrate | db:revert | db:show
 *
 * A script rather than the TypeORM CLI: the CLI's ts-node entrypoints assume
 * CommonJS, and this package is ESM because NestJS 12 is.
 */
import type { DataSource } from 'typeorm';
import { loadConfig } from '../src/config/app-config.js';
import { createDataSource } from '../src/database/data-source.js';

type Command = 'migrate' | 'revert' | 'show';

/**
 * Advisory lock key for schema changes. Any fixed number works; this one is
 * written out rather than hashed so it can be recognised in `pg_locks`.
 */
const SCHEMA_LOCK = 4_242_424_242;

/**
 * Serialises schema changes across processes.
 *
 * Two deployments starting at once is normal — a rolling update, a retried
 * job — and without this they race: one wins, and the other dies on
 * `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`
 * from trying to create the migrations table at the same moment. The outcome
 * was already safe (one migration record, no double application), but a
 * Postgres catalogue error in a deploy log reads like corruption rather than
 * like "someone got here first".
 *
 * Session-scoped, so it needs its own connection: `dataSource.query` takes
 * whichever pooled connection is free, and a lock taken on one of those would
 * be released the moment that connection went back to the pool.
 */
async function withSchemaLock<T>(dataSource: DataSource, work: () => Promise<T>): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();

  try {
    await runner.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);

    return await work();
  } finally {
    await runner.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]);
    await runner.release();
  }
}

const commands = new Set<Command>(['migrate', 'revert', 'show']);

function parseCommand(argument: string | undefined): Command {
  if (argument !== undefined && commands.has(argument as Command)) {
    return argument as Command;
  }
  throw new Error(`Usage: tsx tools/db.ts <${[...commands].join('|')}>`);
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const dataSource = createDataSource(loadConfig());

  await dataSource.initialize();
  try {
    switch (command) {
      case 'migrate': {
        const applied = await withSchemaLock(dataSource, () =>
          dataSource.runMigrations({ transaction: 'each' }),
        );
        console.log(
          applied.length === 0
            ? 'Nothing to migrate.'
            : `Applied:\n${applied.map((m) => `  ${m.name}`).join('\n')}`,
        );
        break;
      }
      case 'revert':
        await withSchemaLock(dataSource, () =>
          dataSource.undoLastMigration({ transaction: 'each' }),
        );
        break;
      case 'show': {
        // Printed here rather than through `dataSource.showMigrations()`:
        // that logs at a level this DataSource does not enable, so the command
        // completed successfully and said nothing at all.
        const applied = await dataSource.query<{ name: string; timestamp: string }[]>(
          `SELECT name, timestamp FROM migrations ORDER BY timestamp`,
        );
        const appliedNames = new Set(applied.map((row) => row.name));

        console.log('Applied:');
        for (const row of applied) console.log(`  ${row.name}`);
        if (applied.length === 0) console.log('  (none)');

        const pending = dataSource.migrations.filter(
          (migration) => !appliedNames.has(migration.name ?? ''),
        );
        console.log('Pending:');
        for (const migration of pending) console.log(`  ${migration.name}`);
        if (pending.length === 0) console.log('  (none)');
        break;
      }
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
