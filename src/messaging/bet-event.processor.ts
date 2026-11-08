import { Inject, Injectable } from '@nestjs/common';
import { PoisonMessageError } from '../common/errors.js';
import { parseMoney } from '../common/money.js';
import { parseTimestamp } from '../common/time.js';
import { SCORING_SERVICE } from '../scoring/scoring.contract.js';
import type { ScoringPort } from '../scoring/scoring.contract.js';
import type { AckReason, BetEventProcessorPort, IncomingBetEvent } from './contracts/index.js';
import { BetRollbackEventDto, BetSettledEventDto } from './dto/index.js';
import { ROUTING_KEY_ROLLBACK, ROUTING_KEY_SETTLED } from './topology.js';
import { validateEvent } from './validate-event.js';

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

  async process({ routingKey, payload }: IncomingBetEvent): Promise<AckReason> {
    if (routingKey === ROUTING_KEY_SETTLED) {
      const event = validateEvent({ dto: BetSettledEventDto, payload });

      // Parsed here, once, so the domain never re-decides what "10.4000"
      // means or which timezone a timestamp was written in.
      const outcome = await this.scoring.settle({
        betId: event.betId,
        playerId: event.playerId,
        currency: event.currency,
        stake: parseMoney('stake', event.stake),
        winAmount: parseMoney('winAmount', event.winAmount),
        settledAt: parseTimestamp('settledAt', event.settledAt),
      });

      return outcome.status;
    }

    if (routingKey === ROUTING_KEY_ROLLBACK) {
      const event = validateEvent({ dto: BetRollbackEventDto, payload });

      // Identity only. The currency and the timestamp in the envelope are
      // validated but deliberately not forwarded: reading either would be a
      // way to leave the points credited.
      const outcome = await this.scoring.rollback({
        betId: event.betId,
        playerId: event.playerId,
      });

      return outcome.status;
    }

    throw new PoisonMessageError(
      'unknown_routing_key',
      `No handler for routing key "${routingKey}"`,
      { routingKey },
    );
  }
}
