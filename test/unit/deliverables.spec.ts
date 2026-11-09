import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The task lists three documents among the things to hand over, so they are
 * checked like anything else that was asked for.
 *
 * A test rather than a checklist because a checklist is what gets forgotten at
 * the end of a long week, and because these files have a job: README explains
 * how to run it, AGENTS.md tells an agent the rules it must not break,
 * DECISIONS.md records what was ambiguous and what was chosen.
 */
const root = join(import.meta.dirname, '..', '..');
const read = (name: string): string => readFileSync(join(root, name), 'utf8');

describe('the documents the task asks for', () => {
  it.each(['README.md', 'AGENTS.md', 'DECISIONS.md'])('ships %s', (name) => {
    expect(existsSync(join(root, name))).toBe(true);
  });

  it('explains in the README how to start the service and drive it', () => {
    const readme = read('README.md');

    expect(readme).toContain('docker compose');
    expect(readme).toContain('npm run produce');
    expect(readme).toContain('/leaderboard');
  });

  it('states the assumptions a reader would otherwise have to guess', () => {
    const readme = read('README.md');

    // The three that change what the service does with a given payload.
    expect(readme).toMatch(/X-Player-Id/);
    expect(readme).toMatch(/FX_RATES/);
    expect(readme).toMatch(/TOURNAMENT_STARTS_AT|окн|window/i);
  });

  it('gives agents the commands and the invariants, per the agents.md format', () => {
    const agents = read('AGENTS.md');

    expect(agents).toMatch(/## Setup commands/);
    expect(agents).toMatch(/## Testing instructions/);
    // The rules that cost money when broken.
    expect(agents).toMatch(/points_awarded/);
    expect(agents).toMatch(/migration|миграц/i);
  });

  it('records the questions the task left open, not just the answers', () => {
    const decisions = read('DECISIONS.md');

    // Each of these is a place where the task admits more than one reading.
    expect(decisions).toMatch(/winAmount/);
    expect(decisions).toMatch(/rollback/);
    expect(decisions).toMatch(/X-Player-Id/);
    // And the alternatives that were weighed and dropped.
    expect(decisions).toMatch(/Redis|ZSET/);
  });
  it('keeps the index of DECISIONS in step with its own headings', () => {
    // The index is the first thing a reader uses and the easiest thing to let
    // rot: a decision added at the end is a decision nobody finds. The same
    // rot had already happened in PLAN.md, where three statements outlived the
    // measurement that refuted them.
    const decisions = read('DECISIONS.md');

    const headings = [...decisions.matchAll(/^## (\d+)\. (.+)$/gm)];
    expect(headings.length).toBeGreaterThan(10);

    for (const [, number, title] of headings) {
      // The title as written, not a slug: a renamed heading has to be renamed
      // in the index too, and a link whose text no longer matches is the bug
      // this catches.
      expect(decisions, `decision ${number} is missing from the index`).toContain(
        `${number}. [${title}](#`,
      );
    }

    // And nothing in the index that no longer exists as a heading.
    const indexed = [...decisions.matchAll(/^(\d+)\. \[(.+?)\]\(#/gm)];
    for (const [, number, title] of indexed) {
      expect(decisions, `the index points at a decision ${number} that is gone`).toContain(
        `## ${number}. ${title}`,
      );
    }
  });
});
