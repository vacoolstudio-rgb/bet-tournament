import type { ConsumeMessage } from 'amqplib';
import type { AckReason, FailureOutcome, ParkOutcome } from './message-outcome.js';

/**
 * Largest body this service will read.
 *
 * A bet event is a few hundred bytes; anything approaching this is a producer
 * bug or an attempt to make the consumer do expensive work. Rejected by size
 * before anything walks the structure, so the cost of refusing it does not
 * depend on what is inside.
 */
export const MAX_EVENT_BYTES = 64 * 1024;

/** A delivery as it reaches the domain-facing processor. */
export interface IncomingBetEvent {
  /** `bet.settled`, `bet.rollback`, or something unexpected. */
  readonly routingKey: string;
  /** Unparsed body: validating it is the processor's first job. */
  readonly payload: unknown;
  /** Size of the raw body, which is what the size limit is checked against. */
  readonly sizeBytes: number;
}

export interface BetEventProcessorPort {
  /**
   * Validates, normalises and applies one event.
   *
   * @throws PoisonMessageError when no later attempt could succeed.
   * @throws RetryableError when one could.
   */
  process(event: IncomingBetEvent): Promise<AckReason>;
}

export const BET_EVENT_PROCESSOR = Symbol('BetEventProcessorPort');

export interface FailureContext {
  readonly error: unknown;
  /** 1 on first delivery; dead-letter hops are counted from `x-death`. */
  readonly attempt: number;
}

export interface OutcomeClassifierPort {
  /**
   * Decides between another attempt and the parking lot.
   *
   * The question is not how bad the failure looks but whether a later attempt
   * could differ: a malformed payload or an unconfigured currency never will,
   * a database that is down might.
   */
  classify(context: FailureContext): FailureOutcome;
}

export const OUTCOME_CLASSIFIER = Symbol('OutcomeClassifierPort');

export interface ParkRequest {
  readonly message: ConsumeMessage;
  readonly outcome: ParkOutcome;
}

export interface ParkingPort {
  /**
   * Moves a message that can never succeed to the parking queue, with the
   * reason, the original routing key and the attempt count in its headers.
   *
   * Published explicitly rather than nacked: the queue's dead-letter exchange
   * is the retry hop, so nacking a poison message would send it round the TTL
   * loop instead of parking it.
   */
  park(request: ParkRequest): Promise<void>;
}

export const PARKING_PUBLISHER = Symbol('ParkingPort');

/**
 * What the consumer tells the broker to do with a delivery.
 *
 * A value, not a call on the channel: the consumer decides, the broker
 * translates. `retry` becomes a reject without requeue, which hands the
 * message to the dead-letter route — the TTL hop — rather than redelivering it
 * instantly.
 */
export type DeliveryVerdict = 'ack' | 'retry';

export interface PublishRequest {
  readonly exchange: string;
  readonly routingKey: string;
  /** Published verbatim; the caller owns the serialisation. */
  readonly content: Buffer;
  readonly headers?: Readonly<Record<string, unknown>> | undefined;
}

export interface BrokerPort {
  /** Publishes and waits for the broker to confirm it. */
  publish(request: PublishRequest): Promise<void>;
}

export const BROKER = Symbol('BrokerPort');

/**
 * A handler the broker drives; its verdict decides ack or reject.
 *
 * Lives here rather than beside the implementation because the consumer is
 * written against it: a handler shape owned by the adapter would mean the
 * consumer importing the adapter to say what it is.
 */
export type DeliveryHandler = (
  payload: unknown,
  message: ConsumeMessage,
) => Promise<DeliveryVerdict>;

/**
 * The receiving half of the broker.
 *
 * Separate from `BrokerPort` because publishing and consuming are needed by
 * different callers — the parking publisher only publishes, the consumer only
 * consumes — and a single interface would force each to depend on the half it
 * does not use. One adapter implements both.
 */
export interface BrokerConsumePort {
  /**
   * Registers a handler for a queue and starts consuming.
   *
   * Idempotent with respect to the connection: calling it before the broker is
   * connected is normal, and the handler is re-attached after a reconnection.
   */
  consume(queue: string, handler: DeliveryHandler): Promise<void>;
}

export const BROKER_CONSUME = Symbol('BrokerConsumePort');

export interface BrokerHealthPort {
  /**
   * Whether the broker connection is up right now.
   *
   * Exists so the health check does not have to know what a broker is. The
   * connection manager reconnects on its own, so a `false` here is a statement
   * about this instant — which is what readiness should report, because while
   * it holds, events are piling up in the queue unhandled.
   */
  isConnected(): boolean;
}

export const BROKER_HEALTH = Symbol('BrokerHealthPort');
