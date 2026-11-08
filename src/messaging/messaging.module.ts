import { Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/config.module.js';
import { ScoringModule } from '../scoring/scoring.module.js';
import { BetEventProcessor } from './bet-event.processor.js';
import { BetEventsConsumer } from './bet-events.consumer.js';
import { BrokerHealth } from './broker-health.js';
import {
  BET_EVENT_PROCESSOR,
  BROKER_HEALTH,
  OUTCOME_CLASSIFIER,
  PARKING_PUBLISHER,
} from './contracts/index.js';
import { OutcomeClassifier } from './outcome.classifier.js';
import { ParkingPublisher } from './parking.publisher.js';
import { buildTopology } from './topology.js';

/**
 * AMQP wiring. The topology is declared from config so the broker objects
 * exist before the first message, rather than being created as a side effect
 * of whoever connects first.
 */
@Module({
  imports: [
    ScoringModule,
    RabbitMQModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const topology = buildTopology({ retryTtlMs: config.rabbit.retryTtlMs });

        return {
          uri: config.rabbit.url,
          exchanges: topology.exchanges.map((exchange) => ({
            name: exchange.name,
            type: exchange.type,
            options: exchange.options,
          })),
          queues: topology.queues.map((queue) => ({
            name: queue.name,
            options: queue.options,
          })),
          prefetchCount: config.rabbit.prefetch,
          // Declare the topology before consuming; a missing binding should
          // fail the boot, not silently drop events.
          connectionInitOptions: { wait: true, timeout: 20_000 },
        };
      },
    }),
  ],
  providers: [
    { provide: BET_EVENT_PROCESSOR, useClass: BetEventProcessor },
    { provide: OUTCOME_CLASSIFIER, useClass: OutcomeClassifier },
    { provide: PARKING_PUBLISHER, useClass: ParkingPublisher },
    { provide: BROKER_HEALTH, useClass: BrokerHealth },
    BetEventsConsumer,
  ],
  exports: [BET_EVENT_PROCESSOR, OUTCOME_CLASSIFIER, PARKING_PUBLISHER, BROKER_HEALTH],
})
export class MessagingModule {}
