/**
 * Event producer used to drive the service by hand.
 *
 *   npm run produce -- --scenario=happy
 *   npm run produce -- --scenario=load --count=50000
 *
 * It builds `BetSettledEvent` and `BetRollbackEvent` values from the same
 * contracts the consumer validates against, so a change to the wire format
 * breaks the producer at compile time instead of at runtime.
 */
import { notImplemented } from '../src/common/not-implemented.error.js';
import type { BetRollbackEvent, BetSettledEvent } from '../src/messaging/contracts/index.js';

export type ScenarioName =
  | 'happy'
  | 'duplicate'
  | 'rollback'
  | 'rollback-first'
  | 'rollback-twice'
  | 'losing-bet'
  | 'unknown-currency'
  | 'rollback-unknown-currency'
  | 'out-of-window'
  | 'rollback-out-of-window'
  | 'malformed'
  | 'load';

export interface Scenario {
  readonly name: ScenarioName;
  /** What publishing this proves, printed by `--list`. */
  readonly proves: string;
}

/**
 * Each scenario exists to make one claim checkable, including the two that
 * only look like edge cases until they cost a player their points:
 * `rollback-unknown-currency` and `rollback-out-of-window`.
 */
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

/**
 * One message as the producer intends to publish it.
 *
 * `raw` carries a body verbatim, which is how the `malformed` scenario
 * publishes something the DTO must reject — a typed event can never express an
 * invalid one, and that is the point of the types everywhere else.
 */
export type PlannedMessage =
  | {
      readonly kind: 'settled';
      readonly routingKey: 'bet.settled';
      readonly payload: BetSettledEvent;
    }
  | {
      readonly kind: 'rollback';
      readonly routingKey: 'bet.rollback';
      readonly payload: BetRollbackEvent;
    }
  | { readonly kind: 'raw'; readonly routingKey: string; readonly body: string };

export interface ProducerOptions {
  readonly scenario: ScenarioName;
  /** Only meaningful for `load`. */
  readonly count: number;
}

/**
 * Builds the messages a scenario publishes.
 *
 * Separated from publishing so a test can assert the plan without a broker,
 * and so `--dry-run` can print it.
 */
export function planScenario(_options: ProducerOptions): readonly PlannedMessage[] {
  return notImplemented('planScenario');
}

/** Publishes the planned messages to the `bets` exchange. */
export function runScenario(_options: ProducerOptions): Promise<void> {
  return notImplemented('runScenario');
}
