import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { ConsumeMessage } from 'amqplib';
import { notImplemented } from '../common/not-implemented.error.js';
import type { MessageOutcome } from './message-outcome.js';

@Injectable()
export class ParkingPublisher {
  constructor(private readonly amqp: AmqpConnection) {}

  /**
   * Moves a message that can never succeed to the parking queue, with the
   * reason, the original routing key and the attempt count in the headers.
   *
   * Published explicitly instead of being nacked into the dead-letter
   * exchange: that exchange is the retry hop, so nacking a poison message
   * would send it around the TTL loop instead of parking it. The original is
   * acked by the caller once this resolves — losing the body would be worse
   * than parking it twice.
   */
  park(
    _message: ConsumeMessage,
    _outcome: Extract<MessageOutcome, { kind: 'park' }>,
  ): Promise<void> {
    return notImplemented('ParkingPublisher.park', this.amqp);
  }
}
