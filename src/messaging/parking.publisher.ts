import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { ParkingPort, ParkRequest } from './contracts/index.js';
import {
  EXCHANGE_PARKED,
  HEADER_PARK_AT,
  HEADER_PARK_ATTEMPTS,
  HEADER_PARK_ERROR,
  HEADER_PARK_REASON,
  HEADER_PARK_ROUTING_KEY,
  ROUTING_KEY_PARKED,
} from './topology.js';

/** Long enough to identify the failure, short enough not to bloat a header. */
const MAX_ERROR_HEADER = 512;

@Injectable()
export class ParkingPublisher implements ParkingPort {
  constructor(private readonly amqp: AmqpConnection) {}

  async park({ message, outcome }: ParkRequest): Promise<void> {
    await this.amqp.publish(EXCHANGE_PARKED, ROUTING_KEY_PARKED, message.content, {
      persistent: true,
      headers: {
        // The original headers come along — `x-death` among them, which is the
        // only record of how the message got here.
        ...message.properties.headers,
        [HEADER_PARK_REASON]: outcome.reason,
        [HEADER_PARK_ERROR]: `${outcome.error.name}: ${outcome.error.message}`.slice(
          0,
          MAX_ERROR_HEADER,
        ),
        [HEADER_PARK_ROUTING_KEY]: message.fields.routingKey,
        [HEADER_PARK_ATTEMPTS]: outcome.attempts,
        [HEADER_PARK_AT]: new Date().toISOString(),
      },
    });
  }
}
