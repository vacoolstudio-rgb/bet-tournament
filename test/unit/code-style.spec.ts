import { readdir, readFile } from 'node:fs/promises';

/**
 * Where behaviour is allowed to live.
 *
 * A class keeps its own logic in private methods; a standalone function
 * belongs in a module that is nothing but functions — `common/money.ts`,
 * `messaging/topology.ts`, `messaging/validate-event.ts`. The mixed form, a
 * class with loose helpers above and below it, is the one this rejects: the
 * helpers read as shared when nothing else uses them, they cannot be
 * overridden or stubbed, and "where does this behaviour live" stops having one
 * answer per file.
 *
 * Asserted rather than remembered because the pull is constant — a mapper
 * extracted out of a method is one keystroke from becoming a module-level
 * `const`, and nothing else in the project would mind.
 */
const SOURCE_ROOTS = ['src/', 'tools/'];

/** A class declaration at the top level of a file. */
const DECLARES_CLASS = /^(?:@\w|export class |class |abstract class )/m;

/**
 * A function declared at the top level: `function f`, or a `const` bound to an
 * arrow with a parameter list. Indentation excludes anything inside a class or
 * a function body, which is where closures legitimately live.
 */
const TOP_LEVEL_FUNCTION =
  /^(?:export )?(?:async )?function |^(?:export )?const [A-Za-z_$][\w$]* *(?::[^=\n]*)?= *(?:async )?\([^)]*\) *(?::[^=\n]*)?=>/m;

async function filesUnder(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);

      return entry.isDirectory() ? filesUnder(child) : [child];
    }),
  );

  return nested.flat().filter((file) => file.pathname.endsWith('.ts'));
}

describe('source files', () => {
  it('keep a class and loose functions out of the same file', async () => {
    const offenders: string[] = [];

    for (const root of SOURCE_ROOTS) {
      for (const file of await filesUnder(new URL(`../../${root}`, import.meta.url))) {
        const source = await readFile(file, 'utf8');
        if (!DECLARES_CLASS.test(source)) continue;
        if (!TOP_LEVEL_FUNCTION.test(source)) continue;

        offenders.push(file.pathname.slice(file.pathname.indexOf(root)));
      }
    }

    // A file in this list has a choice to make: the function becomes a private
    // method, or it moves to a module of functions.
    expect(offenders).toEqual([]);
  });
});
