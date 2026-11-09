import { readFile } from 'node:fs/promises';
import { envSchema } from '../../../src/config/env.schema.js';

/**
 * That `.env.example` is enough to start with.
 *
 * It is the first file anyone copies and the only description of what the
 * service needs, so a required variable missing from it turns the quick start
 * into six lines of validation errors — which is exactly what happened when a
 * fresh clone was followed to the letter.
 *
 * The schema is the source of truth here, not the file: every variable the
 * schema insists on must appear, and every variable the file lists must be one
 * the schema knows, or the file is teaching a reader about settings that do
 * nothing.
 */
const EXAMPLE = new URL('../../../.env.example', import.meta.url);

/** Names assigned in the example, comments and blank lines ignored. */
async function exampleNames(): Promise<string[]> {
  const text = await readFile(EXAMPLE, 'utf8');

  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split('=')[0] ?? '')
    .filter((name) => name.length > 0);
}

/** Variables the schema rejects a configuration for not having. */
function requiredNames(): string[] {
  const parsed = envSchema.safeParse({});
  if (parsed.success) return [];

  return parsed.error.issues
    .map((issue) => String(issue.path[0] ?? ''))
    .filter((name) => name.length > 0);
}

describe('.env.example', () => {
  it('lists every variable the schema requires', async () => {
    const listed = new Set(await exampleNames());
    const missing = requiredNames().filter((name) => !listed.has(name));

    expect(missing).toEqual([]);
  });

  it('lists nothing that is read nowhere', async () => {
    // A stale name here is worse than no name: it reads as supported. The
    // schema is not the only legitimate reader, though — tracing starts before
    // the configuration is validated and takes its own variables straight from
    // the environment, so that file counts too, and is checked rather than
    // trusted.
    const tracing = await readFile(
      new URL('../../../src/observability/tracing.ts', import.meta.url),
      'utf8',
    );

    // The schema's own keys, which is the only honest way to ask. A
    // `safeParse` probe cannot answer it: parsing an object that is missing
    // every other variable fails whatever the extra key is, so the first
    // version of this test called every name known, invented ones included.
    const declared = new Set(Object.keys(envSchema.shape));

    const orphans = (await exampleNames()).filter(
      (name) => !declared.has(name) && !tracing.includes(`'${name}'`),
    );

    expect(orphans).toEqual([]);
  });
});
