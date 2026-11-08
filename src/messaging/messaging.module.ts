import { Module } from '@nestjs/common';
import { ScoringModule } from '../scoring/scoring.module.js';
import { AmqpBroker } from './amqp-broker.js';
import { BetEventProcessor } from './bet-event.processor.js';
import { BetEventsConsumer } from './bet-events.consumer.js';
import {
  BET_EVENT_PROCESSOR,
  BROKER,
  BROKER_CONSUME,
  BROKER_HEALTH,
  OUTCOME_CLASSIFIER,
  PARKING_PUBLISHER,
} from './contracts/index.js';
import { OutcomeClassifier } from './outcome.classifier.js';
import { ParkingPublisher } from './parking.publisher.js';

/**
 * AMQP wiring.
 *
 * The broker is one provider behind three tokens: `BROKER` for publishing,
 * `BROKER_CONSUME` for receiving and `BROKER_HEALTH` for readiness. Three
 * halves of one adapter, so that each caller depends on the part it uses and
 * nothing in the project has to name the class. `useExisting` keeps it a
 * single connection — three providers would mean three sockets and a health
 * check reporting on a connection nobody consumes from.
 */
@Module({
  imports: [ScoringModule],
  providers: [
    AmqpBroker,
    { provide: BROKER, useExisting: AmqpBroker },
    { provide: BROKER_CONSUME, useExisting: AmqpBroker },
    { provide: BROKER_HEALTH, useExisting: AmqpBroker },
    { provide: BET_EVENT_PROCESSOR, useClass: BetEventProcessor },
    { provide: OUTCOME_CLASSIFIER, useClass: OutcomeClassifier },
    { provide: PARKING_PUBLISHER, useClass: ParkingPublisher },
    BetEventsConsumer,
  ],
  exports: [
    BET_EVENT_PROCESSOR,
    OUTCOME_CLASSIFIER,
    PARKING_PUBLISHER,
    BROKER,
    BROKER_CONSUME,
    BROKER_HEALTH,
  ],
})
export class MessagingModule {}
