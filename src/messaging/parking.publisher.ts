import { Inject, Injectable } from '@nestjs/common';
import { BROKER } from './contracts/index.js';
import type { BrokerPort, ParkingPort, ParkRequest } from './contracts/index.js';
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
  constructor(@Inject(BROKER) private readonly broker: BrokerPort) {}

  /**
   * Moves a message that can never succeed to the parking queue, with the
   * reason, the original routing key and the attempt count in its headers.
   *
   * Published explicitly rather than rejected: the queue's dead-letter
   * exchange is the retry hop, so rejecting a poison message would send it
   * round the TTL loop instead of parking it. The caller acknowledges the
   * original only after this resolves, and publisher confirms are what make
   * that safe.
   */
  async park({ message, outcome }: ParkRequest): Promise<void> {
    await this.broker.publish({
      exchange: EXCHANGE_PARKED,
      routingKey: ROUTING_KEY_PARKED,
      // Byte for byte: whoever opens the parking queue needs the payload that
      // failed, not a re-serialised approximation of it.
      content: message.content,
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
