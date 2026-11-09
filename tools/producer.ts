/**
 * Event producer used to drive the service by hand.
 *
 *   npm run produce -- --list
 *   npm run produce -- --scenario=happy
 *   npm run produce -- --scenario=load --count=50000
 *   npm run produce -- --scenario=rollback --dry-run
 *
 * It builds `BetSettledEvent` and `BetRollbackEvent` values from the same
 * contracts the consumer validates against, so a change to the wire format
 * breaks the producer at compile time instead of at runtime.
 */
// Tracing first, so the publish carries `traceparent` and a hand-driven
// event belongs to the same trace as the consumer that handles it.
import { shutdownTracing } from '../src/observability/tracing.js';
import { randomUUID } from 'node:crypto';
import amqp from 'amqp-connection-manager';
import type { Channel } from 'amqplib';
import { loadConfig } from '../src/config/app-config.js';
import { reportConfigurationError } from '../src/config/report-configuration-error.js';
import type { BetRollbackEvent, BetSettledEvent } from '../src/messaging/contracts/index.js';
import {
  buildTopology,
  EXCHANGE_BETS,
  ROUTING_KEY_ROLLBACK,
  ROUTING_KEY_SETTLED,
} from '../src/messaging/topology.js';

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
  | 'rollback-stale-timestamp'
  | 'malformed'
  | 'board'
  | 'chaos'
  | 'load';

export interface Scenario {
  readonly name: ScenarioName;
  /** What publishing this proves, printed by `--list`. */
  readonly proves: string;
}

/**
 * Each scenario exists to make one claim checkable, including the two that
 * only look like edge cases until they cost a player their points:
 * `rollback-unknown-currency` and `rollback-stale-timestamp`.
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
    // The previous wording of this scenario claimed a rollback removes the
    // points of a bet settled outside the window — which cannot happen,
    // because such a bet is never credited in the first place. What actually
    // needs proving is the reverse: the bet is scored normally, and the
    // rollback arrives with a `settledAt` outside the window. Checking that
    // field here would skip the rollback and leave the points forever.
    name: 'rollback-stale-timestamp',
    proves: 'a rollback whose own settledAt falls outside the window still removes the points',
  },
  { name: 'malformed', proves: 'an invalid payload is parked without retries' },
  {
    name: 'board',
    proves: 'the leaderboard is capped at a hundred rows and ordered by points',
  },
  {
    name: 'chaos',
    proves: 'the aggregate still equals the journal after every shape of event at once',
  },
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

export interface TournamentWindowOptions {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface ProducerOptions {
  readonly scenario: ScenarioName;
  /** Only meaningful for `load`. */
  readonly count: number;
  /**
   * Which window counts. The CLI passes the service's own configuration; the
   * default matches `.env.example`, so planning works without an environment
   * and the two cannot drift silently — a scenario built against the wrong
   * window would prove nothing.
   */
  readonly window?: TournamentWindowOptions | undefined;
}

const DEFAULT_WINDOW: TournamentWindowOptions = {
  startsAt: new Date('2026-11-01T00:00:00.000Z'),
  endsAt: new Date('2026-12-01T00:00:00.000Z'),
};

/** A currency no sane configuration carries, for the parking scenarios. */
const UNCONFIGURED_CURRENCY = 'ZZZ';

const settled = (payload: BetSettledEvent): PlannedMessage => ({
  kind: 'settled',
  routingKey: ROUTING_KEY_SETTLED,
  payload,
});

const rolledBack = (payload: BetRollbackEvent): PlannedMessage => ({
  kind: 'rollback',
  routingKey: ROUTING_KEY_ROLLBACK,
  payload,
});

/** Midway through the window, so a scenario is never borderline by accident. */
function inside({ startsAt, endsAt }: TournamentWindowOptions): string {
  return new Date((startsAt.getTime() + endsAt.getTime()) / 2).toISOString();
}

function outside({ startsAt }: TournamentWindowOptions): string {
  return new Date(startsAt.getTime() - 24 * 60 * 60 * 1000).toISOString();
}

function bet(
  window: TournamentWindowOptions,
  overrides: Partial<BetSettledEvent> = {},
): BetSettledEvent {
  return {
    betId: randomUUID(),
    playerId: randomUUID(),
    currency: 'EUR',
    stake: '10.0000',
    winAmount: '10.4000',
    settledAt: inside(window),
    ...overrides,
  };
}

/**
 * Builds the messages a scenario publishes.
 *
 * Separated from publishing so a test can assert the plan without a broker,
 * and so `--dry-run` can print it.
 */
export function planScenario({ scenario, count, window }: ProducerOptions): PlannedMessage[] {
  const w = window ?? DEFAULT_WINDOW;

  switch (scenario) {
    case 'happy': {
      const player = randomUUID();

      // 10.40 EUR at 1.08 is 11.232, 10 GBP at 1.27 is 12.70, 25 USD is 25.
      return [
        bet(w, { playerId: player, currency: 'EUR', winAmount: '10.4000' }),
        bet(w, { playerId: player, currency: 'GBP', winAmount: '10.0000' }),
        bet(w, { playerId: player, currency: 'USD', winAmount: '25.0000' }),
      ].map(settled);
    }

    case 'duplicate': {
      // The same message twice, not two messages that look alike.
      const event = bet(w);

      return [settled(event), settled(event)];
    }

    case 'rollback': {
      const event = bet(w);

      return [settled(event), rolledBack({ betId: event.betId, playerId: event.playerId })];
    }

    case 'rollback-first': {
      const event = bet(w);

      return [rolledBack({ betId: event.betId, playerId: event.playerId }), settled(event)];
    }

    case 'rollback-twice': {
      const event = bet(w);
      const undo = rolledBack({ betId: event.betId, playerId: event.playerId });

      return [settled(event), undo, undo];
    }

    case 'losing-bet':
      return [settled(bet(w, { winAmount: '0.0000' }))];

    case 'unknown-currency':
      return [settled(bet(w, { currency: UNCONFIGURED_CURRENCY }))];

    case 'rollback-unknown-currency': {
      // The settle has to be scoreable, or the scenario proves nothing: the
      // claim is that an unconfigured currency on the rollback cannot stop the
      // debit.
      const event = bet(w, { currency: 'EUR' });

      return [
        settled(event),
        rolledBack({
          betId: event.betId,
          playerId: event.playerId,
          currency: UNCONFIGURED_CURRENCY,
          stake: event.stake,
          winAmount: event.winAmount,
          settledAt: event.settledAt,
        }),
      ];
    }

    case 'out-of-window':
      return [settled(bet(w, { settledAt: outside(w) }))];

    case 'rollback-stale-timestamp': {
      const event = bet(w);

      return [
        settled(event),
        rolledBack({
          betId: event.betId,
          playerId: event.playerId,
          currency: event.currency,
          settledAt: outside(w),
        }),
      ];
    }

    case 'malformed':
      return [{ kind: 'raw', routingKey: ROUTING_KEY_SETTLED, body: '{"betId": not json' }];

    case 'board': {
      // One bet per player, each worth a different amount, so the ordering is
      // unambiguous and `--count` above a hundred shows the cap. Without this
      // the shipped producer could not demonstrate the top-100 at all: every
      // other scenario is about one player.
      return Array.from({ length: count }, (_, index) =>
        settled(
          bet(w, {
            playerId: randomUUID(),
            currency: 'USD',
            winAmount: `${index + 1}.0000`,
          }),
        ),
      );
    }

    case 'chaos': {
      // Every shape a bet can take, interleaved across bets so they contend
      // for the same aggregate row, and all for one player so the contention
      // is maximal.
      //
      // The order within a bet is kept — a queue preserves publish order, and
      // the concurrency comes from prefetch, not from reordering — but the
      // bets are interleaved, which is what a producer replaying a log looks
      // like. The outcome of any single bet is then a race; what must hold
      // regardless is that the aggregate equals the journal.
      const player = randomUUID();
      const shapes = Array.from({ length: count }, (_, index) => {
        const event = bet(w, { playerId: player, currency: 'USD', winAmount: '1.0000' });
        const undo = rolledBack({ betId: event.betId, playerId: player });

        switch (index % 5) {
          case 0:
            return [settled(event)];
          case 1:
            return [settled(event), undo];
          case 2:
            // The same message twice: a redelivery.
            return [settled(event), settled(event)];
          case 3:
            // Out of order: the rollback arrives first.
            return [undo, settled(event)];
          default:
            return [settled(event), undo, undo];
        }
      });

      // Round robin, so bet N's second message lands after bet N+1's first.
      const interleaved: PlannedMessage[] = [];
      for (let step = 0; step < 3; step += 1) {
        for (const shape of shapes) {
          const message = shape[step];
          if (message !== undefined) interleaved.push(message);
        }
      }

      return interleaved;
    }

    case 'load': {
      const player = randomUUID();

      // One player on purpose: it is the aggregate row everything contends
      // for, so this is also the concurrency test.
      return Array.from({ length: count }, () =>
        settled(bet(w, { playerId: player, currency: 'USD', winAmount: '1.0000' })),
      );
    }
  }
}

/** Publishes the planned messages to the `bets` exchange. */
export async function runScenario(options: ProducerOptions): Promise<void> {
  const config = loadConfig();
  const messages = planScenario({ ...options, window: config.tournament });

  const connection = amqp.connect([config.rabbit.url]);
  // The topology is declared here too, so the producer works before the
  // service has ever run — publishing into an exchange that does not exist
  // drops the message without a word.
  const channel = connection.createChannel({
    json: false,
    setup: async (ch: Channel) => {
      const topology = buildTopology({ retryTtlMs: config.rabbit.retryTtlMs });

      for (const exchange of topology.exchanges) {
        await ch.assertExchange(exchange.name, exchange.type, exchange.options);
      }
      for (const queue of topology.queues) {
        await ch.assertQueue(queue.name, queue.options);
        for (const binding of queue.bindings) {
          await ch.bindQueue(queue.name, binding.exchange, binding.routingKey);
        }
      }
    },
  });

  try {
    await channel.waitForConnect();

    for (const message of messages) {
      const content = Buffer.from(
        message.kind === 'raw' ? message.body : JSON.stringify(message.payload),
      );
      await channel.publish(EXCHANGE_BETS, message.routingKey, content, { persistent: true });
    }

    console.log(`Published ${messages.length} message(s) for "${options.scenario}".`);
  } finally {
    await channel.close();
    await connection.close();
  }
}

interface Arguments {
  readonly scenario?: string | undefined;
  readonly count: number;
  readonly list: boolean;
  readonly dryRun: boolean;
}

function parseArguments(argv: readonly string[]): Arguments {
  const value = (name: string): string | undefined =>
    argv.find((argument) => argument.startsWith(`--${name}=`))?.split('=')[1];

  return {
    ...(value('scenario') === undefined ? {} : { scenario: value('scenario') }),
    count: Number(value('count') ?? 1_000),
    list: argv.includes('--list'),
    dryRun: argv.includes('--dry-run'),
  };
}

async function main(): Promise<void> {
  const { scenario, count, list, dryRun } = parseArguments(process.argv.slice(2));

  if (list || scenario === undefined) {
    console.log('Scenarios:\n');
    for (const entry of scenarios) {
      console.log(`  ${entry.name.padEnd(28)} ${entry.proves}`);
    }
    console.log('\nUsage: npm run produce -- --scenario=<name> [--count=N] [--dry-run]');

    return;
  }

  if (!scenarios.some((entry) => entry.name === scenario)) {
    throw new Error(`Unknown scenario "${scenario}". Run with --list to see them all.`);
  }

  const options: ProducerOptions = { scenario: scenario as ScenarioName, count };

  if (dryRun) {
    console.log(JSON.stringify(planScenario(options), null, 2));

    return;
  }

  await runScenario(options);
}

// Only when run as a script: the module is also imported by the tests.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')
) {
  main()
    .then(() => shutdownTracing())
    .catch(async (error: unknown) => {
      // A missing variable is the most likely way this fails for someone
      // running it the first time, and it deserves two lines rather than a
      // stack trace with the issues dumped again below it.
      if (!reportConfigurationError(error)) console.error(error);
      await shutdownTracing();
      process.exit(1);
    });
}
