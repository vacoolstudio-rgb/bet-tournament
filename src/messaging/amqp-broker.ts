import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import amqp from 'amqp-connection-manager';
import type { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import type { Channel, ConsumeMessage } from 'amqplib';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/config.module.js';
import type {
  BrokerHealthPort,
  BrokerPort,
  DeliveryVerdict,
  PublishRequest,
} from './contracts/index.js';
import { buildTopology } from './topology.js';

/** A handler the broker drives; its verdict decides ack or reject. */
export type DeliveryHandler = (
  payload: unknown,
  message: ConsumeMessage,
) => Promise<DeliveryVerdict>;

/**
 * Long enough for a container to finish starting, short enough that a
 * misconfigured URL fails the boot instead of hanging it.
 */
const CONNECT_TIMEOUT_MS = 20_000;

/**
 * How the connection shows up in the broker's own listings.
 *
 * Unnamed connections are a row of ports in the management UI, and the first
 * question during an incident is which of them belongs to this service.
 */
const CONNECTION_NAME = 'bet-tournament';

/**
 * Heartbeats detect a peer that went away without closing the socket — a
 * container killed, a network partition — in roughly two intervals. The
 * reconnect delay is set apart from it rather than inherited: the library
 * defaults to the heartbeat interval, which couples "how fast we notice" to
 * "how long we wait", and those are different questions.
 */
const HEARTBEAT_SECONDS = 10;
const RECONNECT_SECONDS = 2;

/**
 * The AMQP layer, owned rather than borrowed.
 *
 * `@golevelup/nestjs-rabbitmq` would have supplied this and its peer range
 * claims NestJS 12, but it injects `ExternalContextCreator`, which Nest 12 no
 * longer registers — its `InternalCoreModule` provides only `Reflector`,
 * `ReflectorAliasProvider`, `requestProvider` and `inquirerProvider`. The
 * module cannot be instantiated at all, and 9.1.1 is the latest release.
 *
 * What is left to write by hand is small, because the topology is already
 * declared as data: connect with reconnection, assert that topology, consume
 * with a prefetch, and translate a verdict into ack or reject.
 */
@Injectable()
export class AmqpBroker
  implements BrokerPort, BrokerHealthPort, OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(AmqpBroker.name);
  private connection: AmqpConnectionManager | undefined;
  private channel: ChannelWrapper | undefined;
  private readonly handlers = new Map<string, DeliveryHandler>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    const connection = amqp.connect([this.config.rabbit.url], {
      heartbeatIntervalInSeconds: HEARTBEAT_SECONDS,
      reconnectTimeInSeconds: RECONNECT_SECONDS,
      connectionOptions: { clientProperties: { connection_name: CONNECTION_NAME } },
    });
    this.connection = connection;

    // Losing the connection is an event, not an error: the manager reconnects
    // on its own. Saying so in the log is the difference between "the service
    // was down for two minutes" and "the broker was".
    connection.on('disconnect', ({ err }) => {
      this.logger.warn(`Broker connection lost, reconnecting: ${String(err)}`);
    });
    connection.on('connect', () => {
      this.logger.log('Broker connection established, topology declared');
    });

    // The setup function runs on every (re)connection, which is what makes the
    // topology self-healing: a broker that lost its definitions gets them back
    // without a redeploy, and so do the consumers.
    const channel = connection.createChannel({
      json: false,
      setup: (channel: Channel) => this.declare(channel),
    });
    this.channel = channel;

    // Without a listener here, a channel that dies mid-operation surfaces as
    // an unhandled rejection — "Channel ended, no reply will be forthcoming"
    // from whichever RPC was in flight — and Node's default for an unhandled
    // rejection is to end the process. The connection recovers by itself; the
    // process would not have been there to see it.
    channel.on('error', (error: unknown) => {
      this.logger.warn(`Channel error, the manager will re-establish it: ${String(error)}`);
    });

    await this.waitForConnection();
  }

  async onApplicationShutdown(): Promise<void> {
    // Channel first: it cancels the consumers, so in-flight deliveries finish
    // or are requeued by the broker rather than vanishing with the socket.
    await this.channel?.close();
    await this.connection?.close();
  }

  isConnected(): boolean {
    return this.connection?.isConnected() ?? false;
  }

  async publish({ exchange, routingKey, content, headers }: PublishRequest): Promise<void> {
    if (this.channel === undefined) {
      throw new Error('Cannot publish before the broker connection is initialised');
    }

    // Publisher confirms: the promise resolves when the broker has taken
    // responsibility for the message, not when it has left the socket. The
    // parking publisher depends on that — its caller acknowledges the original
    // only after this resolves.
    await this.channel.publish(exchange, routingKey, content, {
      persistent: true,
      ...(headers === undefined ? {} : { headers }),
    });
  }

  /**
   * Registers a handler for a queue and starts consuming.
   *
   * Safe to call before or after the connection exists: `addSetup` runs the
   * function immediately when connected and again after every reconnection.
   */
  async consume(queue: string, handler: DeliveryHandler): Promise<void> {
    this.handlers.set(queue, handler);

    if (this.channel !== undefined) {
      await this.channel.addSetup((channel: Channel) => this.startConsuming(channel, queue));
    }
  }

  private async declare(channel: Channel): Promise<void> {
    const topology = buildTopology({ retryTtlMs: this.config.rabbit.retryTtlMs });

    for (const exchange of topology.exchanges) {
      await channel.assertExchange(exchange.name, exchange.type, exchange.options);
    }

    for (const queue of topology.queues) {
      await channel.assertQueue(queue.name, queue.options);

      for (const binding of queue.bindings) {
        await channel.bindQueue(queue.name, binding.exchange, binding.routingKey);
      }
    }

    await channel.prefetch(this.config.rabbit.prefetch);

    for (const queue of this.handlers.keys()) {
      await this.startConsuming(channel, queue);
    }
  }

  private async startConsuming(channel: Channel, queue: string): Promise<void> {
    const handler = this.handlers.get(queue);
    if (handler === undefined) return;

    await channel.consume(
      queue,
      (message) => {
        // A cancelled consumer delivers null; there is nothing to settle.
        if (message === null) return;

        // Detached on purpose: prefetch is the concurrency limit, so the
        // callback must return before the next delivery can arrive. The
        // delivery's trace context survives anyway — it is current when
        // `settle` is called, and AsyncLocalStorage carries it across every
        // await inside, which is what puts the queries and the log lines of
        // one bet in the trace that started where the event was published.
        // `test/integration/tracing.spec.ts` holds that property down.
        void this.settle(channel, message, handler);
      },
      { noAck: false },
    );
  }

  private async settle(
    channel: Channel,
    message: ConsumeMessage,
    handler: DeliveryHandler,
  ): Promise<void> {
    let verdict: DeliveryVerdict;

    try {
      verdict = await handler(this.parse(message), message);
    } catch (error) {
      // The handler is written not to throw; if it ever does, the message must
      // not be silently dropped, and the delivery limit will eventually park
      // it.
      this.logger.error(`Handler threw for ${message.fields.routingKey}: ${String(error)}`);
      verdict = 'retry';
    }

    this.respond(channel, message, verdict);
  }

  /**
   * Settles the delivery on the channel, tolerating a channel that is no
   * longer there.
   *
   * Acking a dead channel throws, and this runs detached from any awaiting
   * caller, so the throw would become an unhandled rejection — which ends the
   * process by default. There is also nothing useful to do about it: a
   * delivery that was never acknowledged is already back in the queue, and the
   * reconnected consumer will see it again.
   */
  private respond(channel: Channel, message: ConsumeMessage, verdict: DeliveryVerdict): void {
    try {
      if (verdict === 'ack') {
        channel.ack(message);
      } else {
        // Rejected without requeue, so the queue's dead-letter exchange takes
        // it: that is the TTL hop. Requeueing in place would redeliver
        // instantly and burn every attempt in milliseconds.
        channel.nack(message, false, false);
      }
    } catch (error) {
      this.logger.warn(
        `Could not settle ${message.fields.routingKey} on a closed channel; ` +
          `the broker will redeliver it: ${String(error)}`,
      );
    }
  }

  /**
   * A body that is not JSON is handed over as raw bytes rather than throwing
   * here: parking it needs a reason, and there is none to attach inside a
   * parser.
   */
  private parse(message: ConsumeMessage): unknown {
    try {
      return JSON.parse(message.content.toString('utf8'));
    } catch {
      return message.content;
    }
  }

  private async waitForConnection(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        this.channel?.waitForConnect(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `The broker at ${this.config.rabbit.url} did not accept a connection ` +
                    `within ${CONNECT_TIMEOUT_MS} ms`,
                ),
              ),
            CONNECT_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
