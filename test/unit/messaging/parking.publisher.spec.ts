import type { ConsumeMessage } from 'amqplib';
import { PoisonMessageError } from '../../../src/common/errors.js';
import type { BrokerPort, PublishRequest } from '../../../src/messaging/contracts/index.js';
import { ParkingPublisher } from '../../../src/messaging/parking.publisher.js';
import { isIsoTimestamp } from '../../../src/common/time.js';
import {
  EXCHANGE_PARKED,
  HEADER_PARK_AT,
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
  const broker = { publish: vi.fn<BrokerPort['publish']>().mockResolvedValue(undefined) };

  return { subject: new ParkingPublisher(broker), broker };
}

/** The one request the publisher is expected to have made. */
function published(broker: ReturnType<typeof publisher>['broker']): PublishRequest {
  const request = broker.publish.mock.calls[0]?.[0];
  if (request === undefined) throw new Error('nothing was published');

  return request;
}

describe('ParkingPublisher', () => {
  const outcome = {
    kind: 'park',
    reason: 'invalid_schema',
    attempts: 1,
    error: new PoisonMessageError('invalid_schema', 'betId must be a UUID'),
  } as const;

  it('publishes to the parking exchange', async () => {
    const { subject, broker } = publisher();

    await subject.park({ message: delivery(), outcome });

    expect(broker.publish).toHaveBeenCalledTimes(1);
    expect(published(broker).exchange).toBe(EXCHANGE_PARKED);
    expect(published(broker).routingKey).toBe(ROUTING_KEY_PARKED);
  });

  it('keeps the original body byte for byte', async () => {
    // Whoever looks at the parking queue needs the payload that failed, not a
    // re-serialised approximation of it.
    const { subject, broker } = publisher();

    await subject.park({ message: delivery(), outcome });

    expect(published(broker).content).toBe(body);
  });

  it('explains itself in the headers', async () => {
    const { subject, broker } = publisher();

    await subject.park({ message: delivery(), outcome });

    const headers = published(broker).headers ?? {};
    expect(headers[HEADER_PARK_REASON]).toBe('invalid_schema');
    expect(headers[HEADER_PARK_ROUTING_KEY]).toBe(ROUTING_KEY_SETTLED);
    expect(headers[HEADER_PARK_ATTEMPTS]).toBe(1);
    expect(String(headers[HEADER_PARK_ERROR])).toContain('betId must be a UUID');
  });

  it('stamps when it gave up, so the parking queue can be read chronologically', async () => {
    const { subject, broker } = publisher();

    await subject.park({ message: delivery(), outcome });

    expect(isIsoTimestamp((published(broker).headers ?? {})[HEADER_PARK_AT])).toBe(true);
  });

  it('propagates a publish failure instead of swallowing it', async () => {
    // The caller must not acknowledge a message that was never parked.
    const { subject, broker } = publisher();
    broker.publish.mockRejectedValue(new Error('channel closed'));

    await expect(subject.park({ message: delivery(), outcome })).rejects.toThrow('channel closed');
  });

  it('carries the exhausted-attempts reason as well as a payload reason', async () => {
    const { subject, broker } = publisher();

    await subject.park({
      message: delivery(),
      outcome: {
        kind: 'park',
        reason: 'attempts_exhausted',
        attempts: 5,
        error: new Error('connection refused'),
      },
    });

    const headers = published(broker).headers ?? {};
    expect(headers[HEADER_PARK_REASON]).toBe('attempts_exhausted');
    expect(headers[HEADER_PARK_ATTEMPTS]).toBe(5);
  });
});
