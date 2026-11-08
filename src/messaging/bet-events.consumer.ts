import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import { AmqpBroker } from './amqp-broker.js';
import { BET_EVENT_PROCESSOR, OUTCOME_CLASSIFIER, PARKING_PUBLISHER } from './contracts/index.js';
import type {
  BetEventProcessorPort,
  DeliveryVerdict,
  OutcomeClassifierPort,
  ParkingPort,
} from './contracts/index.js';
import { METRICS } from '../observability/metrics.contract.js';
import type { MetricsPort } from '../observability/metrics.contract.js';
import { attemptFromHeaders } from './delivery-attempts.js';
import { QUEUE_BETS } from './topology.js';

/**
 * The AMQP adapter: it owns no rules, only the translation from an outcome to
 * ack / nack / publish.
 */
@Injectable()
export class BetEventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(BetEventsConsumer.name);

  constructor(
    @Inject(BET_EVENT_PROCESSOR) private readonly processor: BetEventProcessorPort,
    @Inject(OUTCOME_CLASSIFIER) private readonly classifier: OutcomeClassifierPort,
    @Inject(PARKING_PUBLISHER) private readonly parking: ParkingPort,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    private readonly broker: AmqpBroker,
  ) {}

  /**
   * One subscription for both event types, on one queue.
   *
   * Two consumers on the same queue would each take whatever came next, so a
   * settle could be handed to the rollback path; the delivery's routing key
   * decides instead, and an unexpected one is parked rather than guessed at.
   */
  async onModuleInit(): Promise<void> {
    await this.broker.consume(QUEUE_BETS, (payload, message) => this.handle(payload, message));
  }

  /**
   * Handles one delivery and says what should become of it.
   *
   * Returns a verdict instead of touching the channel, so the whole error
   * policy is testable without a broker: `retry` becomes a reject without
   * requeue — the dead-letter route, which is the TTL hop — and everything
   * else is acknowledged, the parked cases included.
   */
  async handle(payload: unknown, message: ConsumeMessage): Promise<DeliveryVerdict> {
    const startedAt = performance.now();
    const attempt = attemptFromHeaders(message.properties.headers);
    const routingKey = message.fields.routingKey;

    try {
      const reason = await this.processor.process({ routingKey, payload });
      this.metrics.recordAck(reason);

      return 'ack';
    } catch (error) {
      const outcome = this.classifier.classify({ error, attempt });

      if (outcome.kind === 'retry') {
        this.metrics.recordRetry(outcome.attempt);
        this.logger.warn(
          `Retrying ${routingKey} after attempt ${outcome.attempt}: ${outcome.error.message}`,
        );

        return 'retry';
      }

      try {
        await this.parking.park({ message, outcome });
        this.metrics.recordPark(outcome.reason);
        this.logger.error(
          `Parked ${routingKey} after ${outcome.attempts} attempt(s) ` +
            `(${outcome.reason}): ${outcome.error.message}`,
        );

        return 'ack';
      } catch (parkError) {
        // Acknowledging now would drop the payload on the floor. Nacked, it
        // goes round the retry hop and the delivery limit eventually parks it.
        this.logger.error(
          `Could not park ${routingKey}, leaving it to the broker: ${String(parkError)}`,
        );

        return 'retry';
      }
    } finally {
      this.metrics.observeProcessing((performance.now() - startedAt) / 1000);
    }
  }
}
