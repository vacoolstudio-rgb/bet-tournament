import { Inject, Injectable } from '@nestjs/common';
import { notImplemented } from '../common/not-implemented.error.js';
import { SCORING_SERVICE } from '../scoring/scoring.contract.js';
import type { ScoringPort } from '../scoring/scoring.contract.js';
import type { AckReason, BetEventProcessorPort, IncomingBetEvent } from './contracts/index.js';

/**
 * The transport-to-domain boundary.
 *
 * Three jobs, in order: validate the payload against the DTO, normalise it
 * into a command (amounts to `Decimal`, timestamps to `Date`), and dispatch on
 * the routing key. Knows nothing about AMQP, so the error policy can be tested
 * without a broker; knows nothing about SQL, so the domain stays unaware of
 * where events come from.
 */
@Injectable()
export class BetEventProcessor implements BetEventProcessorPort {
  constructor(@Inject(SCORING_SERVICE) private readonly scoring: ScoringPort) {}

  process(_event: IncomingBetEvent): Promise<AckReason> {
    return notImplemented('BetEventProcessor.process', this.scoring);
  }
}
