import { connect } from 'amqplib';
import type { Channel, ChannelModel, GetMessage, Message, Options } from 'amqplib';
import type { Topology } from '../../../src/messaging/topology.js';

/**
 * A thin amqplib client for the tests.
 *
 * The suites drive the broker directly rather than through the application's
 * publisher, so that what is being tested is the topology itself: the hop a
 * rejected message takes, the delay before it comes back, and the headers it
 * carries when it does.
 */
export interface Broker {
  /** Removes and re-declares everything, so a suite owns its own arguments. */
  reset(topology: Topology): Promise<void>;
  publish(exchange: string, routingKey: string, body: unknown, options?: Options.Publish): void;
  /**
   * Bypasses the exchange. Used to deliver something the bindings would never
   * route — the routing key then is the queue name, which is exactly the
   * "unexpected routing key" the consumer has to park rather than guess at.
   */
  sendToQueue(queue: string, body: unknown, options?: Options.Publish): void;
  /** Waits for one message, leaving it unacknowledged. */
  take(queue: string, timeoutMs?: number): Promise<GetMessage>;
  /** Resolves to null if nothing arrives, which is often the assertion. */
  takeMaybe(queue: string, timeoutMs?: number): Promise<GetMessage | null>;
  ack(message: Message): void;
  nack(message: Message, requeue: boolean): void;
  depth(queue: string): Promise<number>;
  /**
   * Empties the queues between tests. Without it a message a previous test
   * left behind — one still cycling through the retry hop, say — arrives in
   * the middle of the next one and makes it fail for a reason that is nowhere
   * in its body.
   */
  purge(...queues: string[]): Promise<void>;
  close(): Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function connectBroker(url: string): Promise<Broker> {
  const connection: ChannelModel = await connect(url);
  const channel: Channel = await connection.createChannel();

  async function take(queue: string, timeoutMs = 5_000): Promise<GetMessage | null> {
    const deadline = Date.now() + timeoutMs;

    do {
      const message = await channel.get(queue, { noAck: false });
      if (message !== false) return message;
      await sleep(50);
    } while (Date.now() < deadline);

    return null;
  }

  return {
    async reset(topology: Topology): Promise<void> {
      // Deleted first: a queue already declared with a different TTL cannot be
      // re-declared, and the error for that is a cryptic PRECONDITION_FAILED.
      for (const queue of topology.queues) await channel.deleteQueue(queue.name);
      for (const exchange of topology.exchanges) await channel.deleteExchange(exchange.name);

      for (const exchange of topology.exchanges) {
        await channel.assertExchange(exchange.name, exchange.type, exchange.options);
      }
      for (const queue of topology.queues) {
        await channel.assertQueue(queue.name, queue.options);
        for (const binding of queue.bindings) {
          await channel.bindQueue(queue.name, binding.exchange, binding.routingKey);
        }
      }
    },

    publish(exchange, routingKey, body, options): void {
      const content = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
      channel.publish(exchange, routingKey, content, { persistent: true, ...options });
    },

    sendToQueue(queue, body, options): void {
      const content = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
      channel.sendToQueue(queue, content, { persistent: true, ...options });
    },

    async take(queue, timeoutMs): Promise<GetMessage> {
      const message = await take(queue, timeoutMs);
      if (message === null) throw new Error(`no message arrived in ${queue}`);

      return message;
    },

    takeMaybe: (queue, timeoutMs = 1_000) => take(queue, timeoutMs),

    ack(message): void {
      channel.ack(message);
    },

    nack(message, requeue): void {
      channel.nack(message, false, requeue);
    },

    async purge(...queues): Promise<void> {
      for (const queue of queues) await channel.purgeQueue(queue);
    },

    async depth(queue): Promise<number> {
      return (await channel.checkQueue(queue)).messageCount;
    },

    async close(): Promise<void> {
      await channel.close();
      await connection.close();
    },
  };
}

/** Reads a queue's declared arguments back from the management API. */
export async function queueArguments(
  managementUrl: string,
  queue: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${managementUrl}/api/queues/%2F/${queue}`, {
    headers: { authorization: `Basic ${Buffer.from('guest:guest').toString('base64')}` },
  });
  if (!response.ok) throw new Error(`management API said ${response.status} for ${queue}`);

  const body = (await response.json()) as { arguments: Record<string, unknown>; type?: string };

  return { ...body.arguments, 'queue-type': body.type };
}
