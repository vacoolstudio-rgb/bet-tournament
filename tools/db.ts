/**
 * Migration runner for local work.
 *
 *   npm run db:migrate | db:revert | db:show
 *
 * A script rather than the TypeORM CLI: the CLI's ts-node entrypoints assume
 * CommonJS, and this package is ESM because NestJS 12 is.
 */
import { loadConfig } from '../src/config/app-config.js';
import { createDataSource } from '../src/database/data-source.js';

type Command = 'migrate' | 'revert' | 'show';

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
        const applied = await dataSource.runMigrations({ transaction: 'each' });
        console.log(
          applied.length === 0
            ? 'Nothing to migrate.'
            : `Applied:\n${applied.map((m) => `  ${m.name}`).join('\n')}`,
        );
        break;
      }
      case 'revert':
        await dataSource.undoLastMigration({ transaction: 'each' });
        break;
      case 'show':
        await dataSource.showMigrations();
        break;
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
