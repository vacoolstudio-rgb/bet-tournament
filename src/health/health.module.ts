import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { MessagingModule } from '../messaging/messaging.module.js';
import { HealthController } from './health.controller.js';

/**
 * Imports the messaging module for the AMQP connection rather than opening one
 * of its own: a health check that connects separately reports on a connection
 * nobody consumes from.
 */
@Module({
  imports: [TerminusModule, MessagingModule],
  controllers: [HealthController],
})
export class HealthModule {}
