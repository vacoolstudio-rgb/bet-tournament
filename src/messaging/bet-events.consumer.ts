import { Injectable, Logger } from '@nestjs/common';
import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import type { ConsumeMessage } from 'amqplib';
import { notImplemented } from '../common/not-implemented.error.js';
import { BetEventProcessor } from './bet-event.processor.js';
import { OutcomeClassifier } from './outcome.classifier.js';
import { ParkingPublisher } from './parking.publisher.js';
import {
  EXCHANGE_BETS,
  QUEUE_BETS,
  ROUTING_KEY_ROLLBACK,
  ROUTING_KEY_SETTLED,
} from './topology.js';

@Injectable()
export class BetEventsConsumer {
  private readonly logger = new Logger(BetEventsConsumer.name);

  constructor(
    private readonly processor: BetEventProcessor,
    private readonly classifier: OutcomeClassifier,
    private readonly parking: ParkingPublisher,
  ) {}

  /**
   * The single subscription for both event types.
   *
   * One subscription with two routing keys, not two subscriptions on one
   * queue: two consumers on the same queue would each receive whatever came
   * next, so a settle could be handed to the rollback handler. The routing key
   * on the delivery decides, and an unexpected one is parked rather than
   * guessed at.
   *
   * The handler returns `Nack(false)` for a retryable failure, which hands the
   * message to the queue's dead-letter exchange — the TTL retry hop — and
   * acknowledges in every other case, including the ones where the message was
   * moved to the parking queue first.
   */
  @RabbitSubscribe({
    exchange: EXCHANGE_BETS,
    routingKey: [ROUTING_KEY_SETTLED, ROUTING_KEY_ROLLBACK],
    queue: QUEUE_BETS,
    // A body that is not JSON is a poison message, and handling it here means
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
    );
  }
}
