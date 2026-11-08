import { inject } from 'vitest';
import { attemptFromHeaders } from '../../src/messaging/delivery-attempts.js';
import {
  buildTopology,
  EXCHANGE_BETS,
  EXCHANGE_PARKED,
  HEADER_PARK_REASON,
  QUEUE_BETS,
  QUEUE_PARKED,
  QUEUE_RETRY,
  ROUTING_KEY_PARKED,
  ROUTING_KEY_ROLLBACK,
  ROUTING_KEY_SETTLED,
} from '../../src/messaging/topology.js';
import { TEST_RETRY_TTL_MS } from './support/app.js';
import { connectBroker, queueArguments } from './support/broker.js';
import type { Broker } from './support/broker.js';
import { settledEvent } from '../support/builders.js';

/**
 * Tests the topology against a real broker, which is the only place it can be
 * tested: whether a rejected message comes back after a delay, and whether the
 * attempt counter can be read from what RabbitMQ actually writes, are facts
 * about RabbitMQ rather than about this code.
 *
 * The TTL is short here; everything else is exactly what the service declares.
 */
/**
 * The same delay the application is configured with in tests.
 *
 * Not a local constant: the other suites boot the application, which declares
 * these very queues, and a queue cannot be re-declared with a different TTL —
 * the two numbers drifting apart would surface as a PRECONDITION_FAILED with
 * nothing in it about TTLs.
 */
const RETRY_TTL_MS = TEST_RETRY_TTL_MS;
const topology = buildTopology({ retryTtlMs: RETRY_TTL_MS });

let broker: Broker;

beforeAll(async () => {
  broker = await connectBroker(inject('amqpUrl'));
}, 60_000);

afterAll(async () => {
  await broker?.close();
});

beforeEach(async () => {
  await broker.reset(topology);
});

describe('the declared topology', () => {
  it('declares the main queue as quorum with the arguments the policy needs', async () => {
    const args = await queueArguments(inject('managementUrl'), QUEUE_BETS);

    expect(args['queue-type']).toBe('quorum');
    expect(args['x-dead-letter-exchange']).toBe('bets.retry');
    expect(args['x-delivery-limit']).toBe(20);
  });

  it('declares the retry queue as classic with the TTL from config', async () => {
    const args = await queueArguments(inject('managementUrl'), QUEUE_RETRY);

    expect(args['queue-type']).toBe('classic');
    expect(args['x-message-ttl']).toBe(RETRY_TTL_MS);
    expect(args['x-dead-letter-exchange']).toBe(EXCHANGE_BETS);
  });
});

describe('routing', () => {
  it('delivers both event types to the one queue', async () => {
    broker.publish(EXCHANGE_BETS, ROUTING_KEY_SETTLED, settledEvent());
    broker.publish(EXCHANGE_BETS, ROUTING_KEY_ROLLBACK, settledEvent());

    const first = await broker.take(QUEUE_BETS);
    const second = await broker.take(QUEUE_BETS);
    broker.ack(first);
    broker.ack(second);

    expect([first.fields.routingKey, second.fields.routingKey]).toEqual([
      ROUTING_KEY_SETTLED,
      ROUTING_KEY_ROLLBACK,
    ]);
  });

  it('drops an event nobody bound, instead of queueing it somewhere surprising', async () => {
    broker.publish(EXCHANGE_BETS, 'bet.cashout', settledEvent());

    expect(await broker.takeMaybe(QUEUE_BETS, 500)).toBeNull();
  });
});

describe('the retry hop', () => {
  it('sends a rejected message to the retry queue, not to the parking one', async () => {
    broker.publish(EXCHANGE_BETS, ROUTING_KEY_SETTLED, settledEvent());
    broker.nack(await broker.take(QUEUE_BETS), false);

    // Immediately after the reject it is waiting out its TTL, not parked.
    await expect.poll(() => broker.depth(QUEUE_RETRY), { timeout: 2_000 }).toBe(1);
    expect(await broker.depth(QUEUE_PARKED)).toBe(0);
  });

  it('returns the message to the main queue after the delay', async () => {
    // The reason the TTL exists: requeueing in place redelivers instantly, so
    // a two-second database outage would burn every attempt in milliseconds.
    broker.publish(EXCHANGE_BETS, ROUTING_KEY_SETTLED, settledEvent());
    const first = await broker.take(QUEUE_BETS);
    const rejectedAt = Date.now();
    broker.nack(first, false);

    const second = await broker.take(QUEUE_BETS, 5_000);
    broker.ack(second);

    expect(Date.now() - rejectedAt).toBeGreaterThanOrEqual(RETRY_TTL_MS - 100);
    expect(second.content.toString()).toBe(first.content.toString());
  });

  it('keeps the original routing key across the round trip', async () => {
    // The retry queue dead-letters back to `bets`, so the key has to survive
    // or a rollback would come back as something else.
    broker.publish(EXCHANGE_BETS, ROUTING_KEY_ROLLBACK, settledEvent());
    broker.nack(await broker.take(QUEUE_BETS), false);

    const returned = await broker.take(QUEUE_BETS, 5_000);
    broker.ack(returned);

    expect(returned.fields.routingKey).toBe(ROUTING_KEY_ROLLBACK);
  });

  it('records hops in x-death by incrementing a count, not by adding entries', async () => {
    // The assumption the whole retry policy rests on, verified against the
    // broker rather than assumed from the docs: RabbitMQ groups hops by
    // (queue, reason) and increments `count` inside that one entry. Code that
    // counted entries instead would read attempt 1 forever, and a retry loop
    // that never reaches its limit never ends.
    broker.publish(EXCHANGE_BETS, ROUTING_KEY_SETTLED, settledEvent());

    broker.nack(await broker.take(QUEUE_BETS), false);
    const second = await broker.take(QUEUE_BETS, 5_000);
    broker.nack(second, false);
    const third = await broker.take(QUEUE_BETS, 5_000);
    broker.ack(third);

    const xDeath = third.properties.headers?.['x-death'] as { queue: string; count: number }[];
    expect(xDeath).toHaveLength(2);
    expect(xDeath.find((entry) => entry.queue === QUEUE_BETS)?.count).toBe(2);
  });

  it('is not bounded by x-delivery-limit, which the TTL hop resets', async () => {
    // `x-delivery-limit` reads like the thing that stops a message cycling
    // forever. It is not, and relying on it would be a mistake worth spelling
    // out: a rejected message is dead-lettered out of the queue and the TTL
    // hop publishes it back as a new message, so its delivery count starts at
    // one again on every round. Measured with a limit of 3 on a throwaway
    // topology: thirty deliveries in twelve seconds, and `delivery_limit`
    // never appeared in `x-death` at all.
    //
    // What the limit does bound is repeated redelivery within one residency —
    // a handler that never settles, or redelivery after a connection drops.
    // What bounds the retry cycle is the attempt counter below.
    const limit = topology.queues.find((queue) => queue.name === QUEUE_BETS)?.options.arguments?.[
      'x-delivery-limit'
    ];
    expect(limit).toBeTypeOf('number');

    broker.publish(EXCHANGE_BETS, ROUTING_KEY_SETTLED, settledEvent());

    // More rounds than any sane limit would allow if it accumulated.
    let message = await broker.take(QUEUE_BETS);
    for (let round = 0; round < 4; round += 1) {
      broker.nack(message, false);
      message = await broker.take(QUEUE_BETS, 5_000);
    }
    broker.ack(message);

    const xDeath = message.properties.headers?.['x-death'] as { reason: string; count: number }[];
    // Still going after four rounds, and the only reason recorded is ours.
    expect(attemptFromHeaders(message.properties.headers)).toBe(5);
    expect(xDeath.map((entry) => entry.reason)).not.toContain('delivery_limit');
  });

  it('is counted as the attempt number the classifier sees', async () => {
    broker.publish(EXCHANGE_BETS, ROUTING_KEY_SETTLED, settledEvent());

    broker.nack(await broker.take(QUEUE_BETS), false);
    const second = await broker.take(QUEUE_BETS, 5_000);
    expect(attemptFromHeaders(second.properties.headers)).toBe(2);

    broker.nack(second, false);
    const third = await broker.take(QUEUE_BETS, 5_000);
    broker.ack(third);
    expect(attemptFromHeaders(third.properties.headers)).toBe(3);
  });
});

describe('the parking queue', () => {
  it('holds what the service publishes to it, with the reason in the headers', async () => {
    broker.publish(EXCHANGE_PARKED, ROUTING_KEY_PARKED, settledEvent(), {
      headers: { [HEADER_PARK_REASON]: 'invalid_schema' },
    });

    const parked = await broker.take(QUEUE_PARKED);
    broker.ack(parked);

    expect(parked.properties.headers?.[HEADER_PARK_REASON]).toBe('invalid_schema');
  });

  it('keeps a parked message until someone takes it, with no TTL to lose it', async () => {
    broker.publish(EXCHANGE_PARKED, ROUTING_KEY_PARKED, settledEvent());

    await new Promise((resolve) => setTimeout(resolve, RETRY_TTL_MS * 2));

    expect(await broker.depth(QUEUE_PARKED)).toBe(1);
  });
});
