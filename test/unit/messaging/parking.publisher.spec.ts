import type { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { ConsumeMessage } from 'amqplib';
import { PoisonMessageError } from '../../../src/common/errors.js';
import { ParkingPublisher } from '../../../src/messaging/parking.publisher.js';
import {
  EXCHANGE_PARKED,
  HEADER_PARK_ATTEMPTS,
  HEADER_PARK_ERROR,
  HEADER_PARK_REASON,
  HEADER_PARK_ROUTING_KEY,
  ROUTING_KEY_PARKED,
  ROUTING_KEY_SETTLED,
} from '../../../src/messaging/topology.js';

const body = Buffer.from('{"betId":"not-a-uuid"}');

function delivery(): ConsumeMessage {
  return {
    fields: { routingKey: ROUTING_KEY_SETTLED, exchange: 'bets', deliveryTag: 7 },
    properties: { headers: {}, messageId: 'm-1' },
    content: body,
  } as unknown as ConsumeMessage;
}

function publisher() {
  const amqp = { publish: vi.fn().mockResolvedValue(true) };

  return { subject: new ParkingPublisher(amqp as unknown as AmqpConnection), amqp };
}

describe('ParkingPublisher', () => {
  const outcome = {
    kind: 'park',
    reason: 'invalid_schema',
    attempts: 1,
    error: new PoisonMessageError('invalid_schema', 'betId must be a UUID'),
  } as const;

  it('publishes to the parking exchange', async () => {
    const { subject, amqp } = publisher();

    await subject.park({ message: delivery(), outcome });

    expect(amqp.publish).toHaveBeenCalledTimes(1);
    expect(amqp.publish.mock.calls[0]?.[0]).toBe(EXCHANGE_PARKED);
    expect(amqp.publish.mock.calls[0]?.[1]).toBe(ROUTING_KEY_PARKED);
  });

  it('keeps the original body byte for byte', async () => {
    // Whoever looks at the parking queue needs the payload that failed, not a
    // re-serialised approximation of it.
    const { subject, amqp } = publisher();

    await subject.park({ message: delivery(), outcome });

    expect(amqp.publish.mock.calls[0]?.[2]).toBe(body);
  });

  it('explains itself in the headers', async () => {
    const { subject, amqp } = publisher();

    await subject.park({ message: delivery(), outcome });

    const headers = amqp.publish.mock.calls[0]?.[3]?.headers as Record<string, unknown>;
    expect(headers[HEADER_PARK_REASON]).toBe('invalid_schema');
    expect(headers[HEADER_PARK_ROUTING_KEY]).toBe(ROUTING_KEY_SETTLED);
    expect(headers[HEADER_PARK_ATTEMPTS]).toBe(1);
    expect(String(headers[HEADER_PARK_ERROR])).toContain('betId must be a UUID');
  });

  it('publishes persistently, so a broker restart does not lose the evidence', async () => {
    const { subject, amqp } = publisher();

    await subject.park({ message: delivery(), outcome });

    expect(amqp.publish.mock.calls[0]?.[3]?.persistent).toBe(true);
  });

  it('propagates a publish failure instead of swallowing it', async () => {
    // The caller must not acknowledge a message that was never parked.
    const { subject, amqp } = publisher();
    amqp.publish.mockRejectedValue(new Error('channel closed'));

    await expect(subject.park({ message: delivery(), outcome })).rejects.toThrow('channel closed');
  });

  it('carries the exhausted-attempts reason as well as a payload reason', async () => {
    const { subject, amqp } = publisher();

    await subject.park({
      message: delivery(),
      outcome: {
        kind: 'park',
        reason: 'attempts_exhausted',
        attempts: 5,
        error: new Error('connection refused'),
      },
    });

    const headers = amqp.publish.mock.calls[0]?.[3]?.headers as Record<string, unknown>;
    expect(headers[HEADER_PARK_REASON]).toBe('attempts_exhausted');
    expect(headers[HEADER_PARK_ATTEMPTS]).toBe(5);
  });
});
