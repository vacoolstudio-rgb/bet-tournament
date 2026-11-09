/**
 * Checks the test counts the README advertises against a finished run.
 *
 *   node --import tsx tools/check-doc-counts.ts <vitest-json> <readme-phrase>
 *
 * The README says how many tests there are, which is the sort of number that
 * goes stale on the next commit and had already done so twice. A reader who
 * runs the suite and sees a different number learns that the documentation is
 * approximate — and then has no way to tell which other numbers are.
 *
 * It takes the report vitest has already written rather than running the suite
 * itself: counting tests statically cannot work, because `it.each` turns one
 * call into several cases.
 */
import { readFileSync } from 'node:fs';

interface VitestReport {
  readonly numTotalTests?: number;
}

export function declaredCount(readme: string, phrase: string): number | undefined {
  const match = new RegExp(`#\\s*(\\d+)\\s+${phrase}`).exec(readme);

  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function main(): void {
  const [reportPath, phrase] = process.argv.slice(2);
  if (reportPath === undefined || phrase === undefined) {
    console.error('usage: check-doc-counts <vitest-json> <readme-phrase>');
    process.exit(2);
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as VitestReport;
  const actual = report.numTotalTests;
  const declared = declaredCount(readFileSync('README.md', 'utf8'), phrase);

  if (declared === undefined) {
    console.error(`README has no "# <N> ${phrase}" line to check against`);
    process.exit(1);
  }
  if (declared !== actual) {
    console.error(
      `README advertises ${declared} tests for "${phrase}", the run produced ${String(actual)}`,
    );
    process.exit(1);
  }

  console.log(`README and the run agree: ${String(actual)} tests (${phrase})`);
}

if (process.argv[1]?.endsWith('check-doc-counts.ts') === true) main();
