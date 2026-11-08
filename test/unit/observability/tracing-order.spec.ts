import { readFile } from 'node:fs/promises';

/**
 * Keeps the tracing import first.
 *
 * The instrumentations patch `amqplib`, `pg` and `http` as those libraries are
 * loaded, so a module imported before the SDK starts is never traced. Nothing
 * fails when this breaks — the service runs, the tests pass, and the traces
 * are quietly empty or partial. An import sorter is enough to cause it, which
 * is why it is asserted rather than commented.
 */
const ENTRYPOINTS = ['src/main.ts', 'tools/producer.ts', 'tools/replay.ts'];

/** The first `import` statement in the file, ignoring comments. */
async function firstImport(path: string): Promise<string> {
  const source = await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
  const line = source
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith('import '));

  return line ?? '';
}

describe('tracing bootstrap', () => {
  it.each(ENTRYPOINTS)('is the first import of %s', async (entrypoint) => {
    expect(await firstImport(entrypoint)).toContain('observability/tracing.js');
  });

  it.each(['tools/producer.ts', 'tools/replay.ts'])(
    '%s waits for the span buffer to flush before exiting',
    async (tool) => {
      // A process that exits on its own leaves the batch exporter's buffer
      // unsent, and a hand-published event then belongs to no trace at all.
      const source = await readFile(new URL(`../../../${tool}`, import.meta.url), 'utf8');

      expect(source).toContain('shutdownTracing()');
    },
  );
});
