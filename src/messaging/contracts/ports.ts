import type { ConsumeMessage } from 'amqplib';
import type { AckReason, FailureOutcome, ParkOutcome } from './message-outcome.js';

/** A delivery as it reaches the domain-facing processor. */
export interface IncomingBetEvent {
  /** `bet.settled`, `bet.rollback`, or something unexpected. */
  readonly routingKey: string;
  /** Unparsed body: validating it is the processor's first job. */
  readonly payload: unknown;
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
