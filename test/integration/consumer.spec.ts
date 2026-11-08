import type { DataSource } from 'typeorm';
import { Decimal } from 'decimal.js';
import {
  EXCHANGE_BETS,
  HEADER_PARK_ATTEMPTS,
  HEADER_PARK_REASON,
  QUEUE_BETS,
  QUEUE_PARKED,
  QUEUE_RETRY,
  ROUTING_KEY_ROLLBACK,
  ROUTING_KEY_SETTLED,
} from '../../src/messaging/topology.js';
import {
  resetAll,
  resetBroker,
  startApp,
  startDatabase,
  TEST_RETRY_TTL_MS,
} from './support/app.js';
import type { Harness } from './support/app.js';
import type { Broker } from './support/broker.js';
import {
  BET_ID,
  OTHER_PLAYER_ID,
  PLAYER_ID,
  rollbackEvent,
  SECOND_BET_ID,
  settledEvent,
  THIRD_BET_ID,
} from '../support/builders.js';

/**
 * The whole path: a message on the exchange, a row in Postgres, and whatever
 * the consumer decided to do with the delivery.
 *
 * Reads go through raw SQL rather than the repositories, so a failure here
 * points at the behaviour under test instead of at the query used to observe
 * it.
 */
let app: Harness;
let broker: Broker;
let dataSource: DataSource;

beforeAll(async () => {
  dataSource = await startDatabase();
  broker = await resetBroker();
  app = await startApp();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await broker?.close();
  await dataSource?.destroy();
});

beforeEach(async () => {
  // Order matters, and in this order for a reason:
  //
  //  1. stop the consumer, or it keeps handling messages while the tables are
  //     being truncated and writes rows back into a clean database;
  //  2. empty the queues, or a message still circling the retry hop from the
  //     previous test arrives in the middle of this one and fails it for a
  //     reason that is nowhere in its body;
  //  3. truncate, tournaments included — safe only because the application is
  //     started again right after and upserts that row from its config.
  await app.close();
  await broker.purge(QUEUE_BETS, QUEUE_RETRY, QUEUE_PARKED);
  await resetAll(dataSource);
  app = await startApp();
});

interface ScoreRow {
  points: string;
  bets_counted: number;
  last_scored_at: Date | null;
}

async function score(playerId = PLAYER_ID): Promise<ScoreRow | null> {
  const [row] = await dataSource.query<ScoreRow[]>(
    `SELECT points, bets_counted, last_scored_at FROM player_scores WHERE player_id = $1`,
    [playerId],
  );

  return row ?? null;
}

async function bet(betId = BET_ID): Promise<Record<string, unknown> | null> {
  const [row] = await dataSource.query<Record<string, unknown>[]>(
    `SELECT status, currency, win_amount, points_awarded FROM bets WHERE bet_id = $1`,
    [betId],
  );

  return row ?? null;
}

const settle = (payload: unknown): void =>
  broker.publish(EXCHANGE_BETS, ROUTING_KEY_SETTLED, payload);
const rollback = (payload: unknown): void =>
  broker.publish(EXCHANGE_BETS, ROUTING_KEY_ROLLBACK, payload);

/** Waits until the aggregate says what the test expects, or gives up. */
const awaitPoints = (expected: string, playerId = PLAYER_ID) =>
  expect.poll(async () => (await score(playerId))?.points, { timeout: 10_000 }).toBe(expected);

describe('scoring settled bets', () => {
  it('awards one point per USD across several currencies', async () => {
    // 10.40 EUR at 1.08 -> 11.232; 10 GBP at 1.27 -> 12.7; 25 USD -> 25.
    settle(settledEvent({ betId: BET_ID, currency: 'EUR', winAmount: '10.4000' }));
    settle(settledEvent({ betId: SECOND_BET_ID, currency: 'GBP', winAmount: '10.0000' }));
    settle(settledEvent({ betId: THIRD_BET_ID, currency: 'USD', winAmount: '25.0000' }));

    await awaitPoints('48.932000');
    expect((await score())?.bets_counted).toBe(3);
  });

  it('scores a redelivered event once', async () => {
    const event = settledEvent();
    settle(event);
    await awaitPoints('11.232000');

    settle(event);
    settle(event);

    // Nothing to wait for, so give the consumer room to be wrong.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect((await score())?.points).toBe('11.232000');
    expect((await score())?.bets_counted).toBe(1);
  });

  it('journals a losing bet without moving the tie-break key', async () => {
    settle(settledEvent({ winAmount: '0.0000' }));

    await expect.poll(async () => (await bet())?.status, { timeout: 10_000 }).toBe('settled');
    const row = await score();
    expect(row?.points).toBe('0.000000');
    expect(row?.bets_counted).toBe(1);
    expect(row?.last_scored_at).toBeNull();
  });

  it('ignores a bet settled outside the tournament window', async () => {
    settle(settledEvent({ settledAt: '2026-10-01T00:00:00.000Z' }));

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(await score()).toBeNull();
    expect(await bet()).toBeNull();
    // Not an error: it was acknowledged, not parked.
    expect(await broker.depth(QUEUE_PARKED)).toBe(0);
  });
});

describe('rolling bets back', () => {
  it('returns the score to where it started', async () => {
    settle(settledEvent());
    await awaitPoints('11.232000');

    rollback(rollbackEvent());

    await awaitPoints('0.000000');
    const row = await score();
    expect(row?.bets_counted).toBe(0);
    expect(row?.last_scored_at).toBeNull();
    expect((await bet())?.status).toBe('rolled_back');
  });

  it('leaves a bet unscored when the rollback arrives first', async () => {
    rollback(rollbackEvent());
    await expect
      .poll(async () => (await bet())?.status, { timeout: 10_000 })
      .toBe('rollback_pending');

    settle(settledEvent());

    await expect.poll(async () => (await bet())?.status, { timeout: 10_000 }).toBe('rolled_back');
    // The audit columns are filled in, but nothing was ever credited.
    expect((await bet())?.win_amount).toBe('10.4000');
    expect((await bet())?.points_awarded).toBe('0.000000');
    expect((await score())?.points ?? '0.000000').toBe('0.000000');
  });

  it('subtracts once however many times the rollback arrives', async () => {
    settle(settledEvent({ betId: BET_ID }));
    settle(settledEvent({ betId: SECOND_BET_ID }));
    await awaitPoints('22.464000');

    rollback(rollbackEvent({ betId: BET_ID }));
    rollback(rollbackEvent({ betId: BET_ID }));
    rollback(rollbackEvent({ betId: BET_ID }));

    await awaitPoints('11.232000');
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect((await score())?.points).toBe('11.232000');
  });

  it('removes the points even when its own currency and timestamp are unusable', async () => {
    // The regression that matters most in this file. A rollback carrying a
    // currency nobody configured and a settledAt outside the window must still
    // void the bet: the amount comes from the journal, and the journal is
    // where the points came from. Filtering on either field here would leave
    // the points credited forever.
    settle(settledEvent());
    await awaitPoints('11.232000');

    rollback(rollbackEvent({ currency: 'XYZ', settledAt: '2020-01-01T00:00:00.000Z' }));

    await awaitPoints('0.000000');
    expect(await broker.depth(QUEUE_PARKED)).toBe(0);
  });

  it('subtracts exactly what was credited, not what today’s rate would give', async () => {
    settle(settledEvent());
    await awaitPoints('11.232000');

    // The config changed between the two events; the journal did not.
    await app.close();
    app = await startApp({ fxRates: { EUR: '2.00' } });

    rollback(rollbackEvent());

    await awaitPoints('0.000000');
  });
});

describe('messages that can never succeed', () => {
  async function parked(): Promise<Record<string, unknown>> {
    const message = await broker.take(QUEUE_PARKED, 10_000);
    broker.ack(message);

    return message.properties.headers ?? {};
  }

  it('parks a settle in a currency nobody configured, instead of scoring zero', async () => {
    settle(settledEvent({ currency: 'XYZ' }));

    expect(await parked()).toMatchObject({ [HEADER_PARK_REASON]: 'unknown_currency' });
    expect(await score()).toBeNull();
  });

  it('parks a malformed body on sight, with no retry hops', async () => {
    broker.publish(EXCHANGE_BETS, ROUTING_KEY_SETTLED, Buffer.from('{not json'));

    const headers = await parked();
    expect(headers[HEADER_PARK_REASON]).toBe('invalid_schema');
    // Attempt 1: retrying a broken payload only wastes deliveries.
    expect(headers[HEADER_PARK_ATTEMPTS]).toBe(1);
  });

  it('parks a payload that fails validation', async () => {
    settle(settledEvent({ betId: 'bet-1' }));

    expect(await parked()).toMatchObject({ [HEADER_PARK_REASON]: 'invalid_schema' });
  });

  it('parks a delivery whose routing key it does not recognise', async () => {
    // Delivered straight to the queue, so the bindings cannot normalise it.
    broker.sendToQueue(QUEUE_BETS, settledEvent());

    expect(await parked()).toMatchObject({ [HEADER_PARK_REASON]: 'unknown_routing_key' });
  });
});

describe('when the database is unavailable', () => {
  const block = (): Promise<unknown> =>
    dataSource.query(`
      CREATE OR REPLACE FUNCTION refuse_write() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated outage'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER refuse_bets BEFORE INSERT ON bets
        FOR EACH ROW EXECUTE FUNCTION refuse_write();
    `);
  const unblock = (): Promise<unknown> =>
    dataSource.query(`DROP TRIGGER IF EXISTS refuse_bets ON bets`);

  afterEach(async () => {
    await unblock();
  });

  it('retries after a delay and succeeds once the write goes through', async () => {
    // The point of the TTL hop: an outage shorter than the retry budget costs
    // latency, not data.
    await block();
    settle(settledEvent());

    await new Promise((resolve) => setTimeout(resolve, TEST_RETRY_TTL_MS / 2));
    expect(await score()).toBeNull();

    await unblock();

    await awaitPoints('11.232000');
    expect(await broker.depth(QUEUE_PARKED)).toBe(0);
  });

  it('parks the event once the attempts run out, saying why', async () => {
    await block();
    settle(settledEvent());

    const message = await broker.take(QUEUE_PARKED, 20_000);
    broker.ack(message);

    const headers = (message.properties.headers ?? {}) as Record<string, unknown>;
    expect(headers[HEADER_PARK_REASON]).toBe('attempts_exhausted');
    expect(headers[HEADER_PARK_ATTEMPTS]).toBe(3);
  });
});

describe('from the queue to the endpoint', () => {
  it('shows a scored bet on the leaderboard', async () => {
    // The only test that closes the loop. Every other suite works on one side
    // of the table — this one proves the writer and the reader agree about it.
    settle(settledEvent({ currency: 'USD', winAmount: '25.0000' }));
    await awaitPoints('25.000000');

    const { body } = await app.http.get('/leaderboard').set('X-Player-Id', PLAYER_ID).expect(200);

    expect(body.top).toEqual([
      {
        rank: 1,
        playerId: PLAYER_ID,
        points: 25,
        pointsExact: '25.000000',
        betsCounted: 1,
      },
    ]);
    expect(body.me.rank).toBe(1);
  });
});

describe('two consumers on the same queue', () => {
  it('credits every event exactly once', async () => {
    // Concurrency is the reason the aggregate is written with an atomic
    // increment: with a read-modify-write, two consumers lose increments and
    // nothing in the logs says so.
    const second = await startApp();

    try {
      const count = 100;
      for (let index = 0; index < count; index += 1) {
        settle(
          settledEvent({
            betId: `88888888-8888-4888-8888-${String(index).padStart(12, '0')}`,
            playerId: OTHER_PLAYER_ID,
            currency: 'USD',
            winAmount: '1.0000',
          }),
        );
      }

      await expect
        .poll(async () => (await score(OTHER_PLAYER_ID))?.bets_counted, { timeout: 60_000 })
        .toBe(count);
      expect(new Decimal((await score(OTHER_PLAYER_ID))?.points ?? '0').toString()).toBe(
        String(count),
      );
    } finally {
      await second.close();
    }
  }, 120_000);
});
