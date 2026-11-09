import { AmqpBroker } from '../../src/messaging/amqp-broker.js';
import {
  EXCHANGE_BETS,
  QUEUE_BETS,
  QUEUE_PARKED,
  QUEUE_RETRY,
  ROUTING_KEY_SETTLED,
} from '../../src/messaging/topology.js';
import { resetBroker, testConfig } from './support/app.js';
import {
  consumerCount,
  killConnection,
  listConnections,
  unacknowledged,
} from './support/broker.js';
import type { Broker } from './support/broker.js';
import { settledEvent } from '../support/builders.js';
import { inject } from 'vitest';

/**
 * When a delivery is acknowledged, relative to the work it stands for.
 *
 * "Ack only after the commit" is the invariant that decides whether a crash
 * loses a settled bet. Acking first and crashing before the commit loses the
 * event outright — nothing redelivers it, because the broker was told it was
 * handled. Committing first and crashing before the ack costs a redelivery,
 * which idempotency absorbs.
 *
 * It held only by the shape of `settle`: `await handler(...)`, then respond.
 * That is one `await` away from being wrong, and nothing would fail — the
 * service would process every message correctly and lose one only on a crash,
 * in production, with no test to point at. So the ordering is observed here
 * from outside, through the broker's own count of unacknowledged deliveries.
 */
let broker: Broker;
let amqp: AmqpBroker;
let managementUrl: string;

/** Resolves the handler currently in flight. */
let release: (() => void) | undefined;

beforeAll(async () => {
  managementUrl = inject('managementUrl');
  broker = await resetBroker();
}, 180_000);

/**
 * A fresh consumer per test, holding whatever it is given until released.
 *
 * Per test rather than per file on purpose: these tests sever connections and
 * abandon deliveries, so one leaving its broker reconnected and a message
 * requeued would decide what the next one observes. The first version of this
 * file shared one consumer and the third test failed for reasons that had
 * nothing to do with it.
 */
/**
 * Waits until nothing else is reading the queue.
 *
 * These tests measure the broker's own count of unacknowledged deliveries, so
 * a consumer left over from another spec file does not merely add noise — it
 * takes the message and acknowledges it, and the count this spec is waiting
 * for never arrives. That is how the suite passed file-by-file and failed in
 * one run.
 */
async function awaitExclusiveQueue(): Promise<void> {
  const deadline = Date.now() + 30_000;
  let others = await consumerCount(managementUrl, QUEUE_BETS);
  while (others > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    others = await consumerCount(managementUrl, QUEUE_BETS);
  }

  expect(others, `${QUEUE_BETS} still has a consumer that is not this spec's`).toBe(0);
}

async function startConsumer(): Promise<AmqpBroker> {
  const started = new AmqpBroker(testConfig());
  await started.onModuleInit();
  await started.consume(QUEUE_BETS, async () => {
    // Stands in for the transaction: the delivery must stay unacknowledged
    // for as long as this is running.
    await new Promise<void>((resolve) => {
      release = resolve;
    });

    return 'ack' as const;
  });

  return started;
}

beforeEach(async () => {
  release = undefined;
  await awaitExclusiveQueue();
  await broker.purge(QUEUE_BETS, QUEUE_RETRY, QUEUE_PARKED);
  amqp = await startConsumer();
}, 120_000);

afterEach(async () => {
  release?.();
  release = undefined;
  await amqp?.onApplicationShutdown();
  await broker.purge(QUEUE_BETS, QUEUE_RETRY, QUEUE_PARKED);
}, 120_000);

afterAll(async () => {
  await broker?.close();
});

/** Polls until `read` reports `want`, or fails saying what it saw instead. */
async function until(read: () => Promise<number>, want: number, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let seen = await read();
  while (seen !== want && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    seen = await read();
  }
  expect(seen, label).toBe(want);
}

describe('a delivery being handled', () => {
  it('stays unacknowledged until the handler has finished', async () => {
    const pending = () => unacknowledged(managementUrl, QUEUE_BETS);

    broker.publish(EXCHANGE_BETS, ROUTING_KEY_SETTLED, settledEvent());

    // The handler is now blocked, and the broker still holds the delivery.
    // This is the assertion that fails if `settle` ever responds before
    // awaiting: the count would go to zero without the handler finishing.
    await until(pending, 1, 'the delivery should be outstanding while the handler runs');

    // Still outstanding a moment later — not merely slow to be counted.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(await pending()).toBe(1);

    release?.();
    release = undefined;

    await until(pending, 0, 'the delivery should be acknowledged once the handler returns');
  });

  it('survives the channel dying under a handler that is still working', async () => {
    // The original bug, made deterministic. A handler is in flight when the
    // connection is severed; by the time it returns, the channel it was handed
    // is dead, and amqplib's reaction to a send on a dead channel is not a
    // quiet no-op — it swaps `sendImmediately` for a function that throws
    // `IllegalOperationError('Channel closed')`. Thrown out of a detached
    // `void this.settle(...)`, that is an unhandled rejection, and Node's
    // default for one is to end the process. The service survived the outage
    // logically, answered 503 honestly, and did not live to reconnect.
    //
    // It took a CI run to find the first time, because the window is narrow:
    // handling is sub-millisecond, so a cut lands between deliveries rather
    // than inside one. Here the handler is held open on purpose, which is the
    // difference between reproducing this and hoping for it.
    const unhandled: unknown[] = [];
    const record = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', record);

    try {
      broker.publish(EXCHANGE_BETS, ROUTING_KEY_SETTLED, settledEvent());
      await until(() => unacknowledged(managementUrl, QUEUE_BETS), 1, 'a delivery in flight');

      // Severed while the handler holds it.
      const connections = await listConnections(managementUrl);
      const ours = connections.filter(
        (connection) => connection.client_properties?.connection_name === 'bet-tournament',
      );
      expect(ours.length, 'nothing was severed, so nothing is proved').toBeGreaterThan(0);
      for (const connection of ours) await killConnection(managementUrl, connection.name);

      // Now let it finish. The ack it attempts goes to a channel that no
      // longer exists.
      release?.();
      release = undefined;

      // Long enough for the rejection to surface if it is going to.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    } finally {
      process.off('unhandledRejection', record);
    }

    expect(unhandled.map(String)).toEqual([]);

    // And the event is not lost: unacknowledged when the channel died, it is
    // back in the queue waiting to be handled again.
    await until(() => broker.depth(QUEUE_BETS), 1, 'the event should be back in the queue');
  }, 120_000);

  it('comes back to the queue if the consumer goes away mid-handling', async () => {
    // The other half of the invariant: an unacknowledged delivery is not lost
    // when the process holding it disappears. This is what makes "commit, then
    // ack" safe — the worst case is that the message arrives twice.
    const pending = () => unacknowledged(managementUrl, QUEUE_BETS);

    broker.publish(EXCHANGE_BETS, ROUTING_KEY_SETTLED, settledEvent());
    await until(pending, 1, 'the delivery should be outstanding');

    // Closed while the handler is still blocked, the way a SIGKILL looks to
    // the broker.
    await amqp.onApplicationShutdown();

    const message = await broker.take(QUEUE_BETS, 15_000);
    expect(message.fields.redelivered).toBe(true);
    broker.ack(message);
  });
});
