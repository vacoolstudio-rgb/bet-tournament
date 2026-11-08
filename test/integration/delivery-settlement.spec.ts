import { AmqpBroker } from '../../src/messaging/amqp-broker.js';
import { EXCHANGE_BETS, QUEUE_BETS, ROUTING_KEY_SETTLED } from '../../src/messaging/topology.js';
import { resetBroker, testConfig } from './support/app.js';
import { unacknowledged } from './support/broker.js';
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

  amqp = new AmqpBroker(testConfig());
  await amqp.onModuleInit();
  await amqp.consume(QUEUE_BETS, async () => {
    // Stands in for the transaction: the delivery must stay unacknowledged
    // for as long as this is running.
    await new Promise<void>((resolve) => {
      release = resolve;
    });

    return 'ack' as const;
  });
}, 180_000);

afterAll(async () => {
  release?.();
  await amqp?.onApplicationShutdown();
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
