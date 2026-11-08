import { Injectable } from '@nestjs/common';
import { notImplemented } from '../common/not-implemented.error.js';
import { ScoringService } from '../scoring/scoring.service.js';
import type { AckReason } from './message-outcome.js';

/**
 * Validates a raw event and routes it to the right scoring call.
 *
 * Deliberately knows nothing about AMQP: the transport adapter catches what
 * this throws and decides between a retry and the parking lot, which keeps the
 * error policy testable without a broker.
 */
@Injectable()
export class BetEventProcessor {
  constructor(private readonly scoring: ScoringService) {}

  /**
   * @throws PoisonMessageError for a payload or routing key that can never
   *         succeed (`invalid_schema`, `unknown_currency`,
   *         `amount_out_of_range`, `unknown_routing_key`).
   * @throws RetryableError for an infrastructure failure.
   */
  process(_routingKey: string, _payload: unknown): Promise<AckReason> {
    return notImplemented('BetEventProcessor.process', this.scoring);
  }
}
