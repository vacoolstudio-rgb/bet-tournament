import { readdir, readFile } from 'node:fs/promises';
import { BROKER, BROKER_CONSUME, BROKER_HEALTH } from '../../../src/messaging/contracts/index.js';

/**
 * Keeps the broker behind its tokens.
 *
 * Everything in this project is injected by token, which is what lets a unit
 * test hand a service an object instead of booting TypeORM and a connection
 * manager. The consumer was the exception: with no port declaring `consume`,
 * it had nowhere to turn but the class, and its test double had to be cast
 * through `unknown` to pretend to be one — a double that lies to the type
 * system cannot report that the thing it stands for has changed.
 *
 * The rule is asserted rather than remembered because the pull back is real:
 * adding a method to the adapter and injecting the class is always the shorter
 * diff than adding it to a port first.
 */
const WIRING = 'messaging.module.ts';

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);

      return entry.isDirectory() ? sourceFiles(child) : [child];
    }),
  );

  return files.flat().filter((file) => file.pathname.endsWith('.ts'));
}

describe('the broker adapter', () => {
  it('is named only by the module that registers it', async () => {
    const files = await sourceFiles(new URL('../../../src/', import.meta.url));

    const namingIt: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const name = file.pathname.split('/').pop() ?? '';
      if (name === 'amqp-broker.ts' || name === WIRING) continue;
      // The import, not a mention in prose: the comments explain the adapter.
      if (/^import .*\bAmqpBroker\b/m.test(source)) namingIt.push(name);
    }

    expect(namingIt).toEqual([]);
  });

  it('answers to three tokens, one per caller', () => {
    // Publishing, receiving and readiness are needed by different callers, so
    // each gets the half it uses rather than an interface with the other two.
    expect(new Set([BROKER, BROKER_CONSUME, BROKER_HEALTH]).size).toBe(3);
  });
});
