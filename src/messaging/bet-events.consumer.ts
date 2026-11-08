import { Inject, Injectable, Logger } from '@nestjs/common';
import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import type { ConsumeMessage } from 'amqplib';
import { notImplemented } from '../common/not-implemented.error.js';
import { BET_EVENT_PROCESSOR, OUTCOME_CLASSIFIER, PARKING_PUBLISHER } from './contracts/index.js';
import type {
  BetEventProcessorPort,
  OutcomeClassifierPort,
  ParkingPort,
} from './contracts/index.js';
import { METRICS } from '../observability/metrics.contract.js';
import type { MetricsPort } from '../observability/metrics.contract.js';
import {
  EXCHANGE_BETS,
  QUEUE_BETS,
  ROUTING_KEY_ROLLBACK,
  ROUTING_KEY_SETTLED,
} from './topology.js';

/**
 * The AMQP adapter: it owns no rules, only the translation from an outcome to
 * ack / nack / publish.
 */
@Injectable()
export class BetEventsConsumer {
  private readonly logger = new Logger(BetEventsConsumer.name);

  constructor(
    @Inject(BET_EVENT_PROCESSOR) private readonly processor: BetEventProcessorPort,
    @Inject(OUTCOME_CLASSIFIER) private readonly classifier: OutcomeClassifierPort,
    @Inject(PARKING_PUBLISHER) private readonly parking: ParkingPort,
    @Inject(METRICS) private readonly metrics: MetricsPort,
  ) {}

  /**
   * The single subscription for both event types.
   *
   * One subscription with two routing keys, not two subscriptions on one
   * queue: two consumers on the same queue would each take whatever came next,
   * so a settle could be handed to the rollback handler. The delivery's
   * routing key decides, and an unexpected one is parked rather than guessed.
   *
   * Returns `Nack(false)` for a retryable failure, which hands the message to
   * the queue's dead-letter exchange — the TTL retry hop — and acknowledges in
   * every other case, including the ones already moved to the parking queue.
   */
  @RabbitSubscribe({
    exchange: EXCHANGE_BETS,
    routingKey: [ROUTING_KEY_SETTLED, ROUTING_KEY_ROLLBACK],
    queue: QUEUE_BETS,
    // A body that is not JSON is a poison message; handling it here means
    // handling it with a reason instead of an unhandled parser error.
    allowNonJsonMessages: true,
  })
  handle(_payload: unknown, _message: ConsumeMessage): Promise<Nack | undefined> {
    return notImplemented(
      'BetEventsConsumer.handle',
      this.logger,
      this.processor,
      this.classifier,
      this.parking,
      this.metrics,
    );
  }
}
