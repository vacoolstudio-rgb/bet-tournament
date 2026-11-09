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

/**
 * The management API, used for the things AMQP itself cannot express: reading
 * back what a queue was really declared with, and severing a connection from
 * the broker's side to see whether the service comes back.
 */
function management(managementUrl: string, path: string, method = 'GET'): Promise<Response> {
  return fetch(`${managementUrl}/api/${path}`, {
    method,
    headers: { authorization: `Basic ${Buffer.from('guest:guest').toString('base64')}` },
  });
}

interface BrokerConnection {
  readonly name: string;
  readonly client_properties?: { readonly connection_name?: string } | undefined;
}

/** Connections the broker currently holds, with whatever names they gave. */
export async function listConnections(managementUrl: string): Promise<BrokerConnection[]> {
  const response = await management(managementUrl, 'connections');
  if (!response.ok) throw new Error(`management API said ${response.status} for connections`);

  return (await response.json()) as BrokerConnection[];
}

/**
 * Closes a connection from the broker's side.
 *
 * This is what a network partition or a broker restart looks like to a client,
 * minus the wait: the socket goes away without a protocol-level goodbye.
 */
export async function killConnection(managementUrl: string, name: string): Promise<void> {
  const response = await management(
    managementUrl,
    `connections/${encodeURIComponent(name)}`,
    'DELETE',
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`management API said ${response.status} closing ${name}`);
  }
}

export async function deleteQueue(managementUrl: string, queue: string): Promise<void> {
  const response = await management(managementUrl, `queues/%2F/${queue}`, 'DELETE');
  if (!response.ok && response.status !== 404) {
    throw new Error(`management API said ${response.status} deleting ${queue}`);
  }
}

export async function queueExists(managementUrl: string, queue: string): Promise<boolean> {
  return (await management(managementUrl, `queues/%2F/${queue}`)).ok;
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

/** How many deliveries a queue is waiting on an acknowledgement for. */
export async function unacknowledged(managementUrl: string, queue: string): Promise<number> {
  const response = await management(managementUrl, `queues/%2F/${queue}`);
  if (!response.ok) throw new Error(`management API said ${response.status} for ${queue}`);

  const body = (await response.json()) as { messages_unacknowledged?: number };

  return body.messages_unacknowledged ?? 0;
}

/** Deletes an exchange, so a publish to it fails the way a misconfigured broker does. */
export async function deleteExchange(managementUrl: string, exchange: string): Promise<void> {
  const response = await management(managementUrl, `exchanges/%2F/${exchange}`, 'DELETE');
  if (!response.ok && response.status !== 404) {
    throw new Error(`management API said ${response.status} deleting ${exchange}`);
  }
}

/** How many consumers the broker currently reports on a queue. */
export async function consumerCount(managementUrl: string, queue: string): Promise<number> {
  const response = await management(managementUrl, `queues/%2F/${queue}`);
  if (!response.ok) throw new Error(`management API said ${response.status} for ${queue}`);

  const body = (await response.json()) as { consumers?: number };

  return body.consumers ?? 0;
}
