import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { BrokerHealthPort } from './contracts/index.js';

/**
 * The one place that turns an AMQP connection into a yes-or-no answer.
 *
 * It exists so that the health module can depend on a port instead of on the
 * broker library — and so that the messaging module does not have to re-export
 * `RabbitMQModule`, which breaks: re-exported, Nest treats the dynamic module
 * as a static one and its own dependencies stop resolving.
 */
@Injectable()
export class BrokerHealth implements BrokerHealthPort {
  constructor(private readonly amqp: AmqpConnection) {}

  isConnected(): boolean {
    return this.amqp.connected;
  }
}
