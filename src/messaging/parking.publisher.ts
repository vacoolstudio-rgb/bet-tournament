import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { notImplemented } from '../common/not-implemented.error.js';
import type { ParkingPort, ParkRequest } from './contracts/index.js';

@Injectable()
export class ParkingPublisher implements ParkingPort {
  constructor(private readonly amqp: AmqpConnection) {}

  park(_request: ParkRequest): Promise<void> {
    return notImplemented('ParkingPublisher.park', this.amqp);
  }
}
