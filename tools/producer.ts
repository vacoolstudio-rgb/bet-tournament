/**
 * Event producer used to drive the service by hand.
 *
 *   npm run produce -- --scenario=happy
 *   npm run produce -- --scenario=load --count=50000
 *
 * Each scenario exists to make one claim checkable, including the two that
 * only look like edge cases until they cost a player their points:
 * `rollback-unknown-currency` and `rollback-out-of-window`.
 */
import { NotImplementedError } from '../src/common/not-implemented.error.js';

export interface Scenario {
  readonly name: string;
  /** What publishing this proves, printed by `--list`. */
  readonly proves: string;
}

export const scenarios: readonly Scenario[] = [
  { name: 'happy', proves: 'settled bets in several currencies score the expected points' },
  { name: 'duplicate', proves: 'the same bet.settled twice scores once' },
  { name: 'rollback', proves: 'settled then rollback returns the score to where it started' },
  { name: 'rollback-first', proves: 'rollback before settle leaves the bet unscored' },
  { name: 'rollback-twice', proves: 'a repeated rollback subtracts once' },
  { name: 'losing-bet', proves: 'a zero-win bet is counted but does not move the tie-break key' },
  { name: 'unknown-currency', proves: 'settled in an unconfigured currency is parked, not zeroed' },
  {
    name: 'rollback-unknown-currency',
    proves: 'a rollback whose currency is unconfigured still removes the points',
  },
  { name: 'out-of-window', proves: 'settled outside the tournament window scores nothing' },
  {
    name: 'rollback-out-of-window',
    proves: 'a rollback for a bet settled outside the window still removes its points',
  },
  { name: 'malformed', proves: 'an invalid payload is parked without retries' },
  { name: 'load', proves: 'throughput and leaderboard latency under volume' },
];

export interface ProducerOptions {
  readonly scenario: string;
  readonly count: number;
}

/** Publishes the scenario's events to the `bets` exchange. */
export function runScenario(_options: ProducerOptions): Promise<void> {
  throw new NotImplementedError('runScenario');
}
