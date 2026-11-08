import { Nack } from '@golevelup/nestjs-rabbitmq';
import type { ConsumeMessage } from 'amqplib';
import { PoisonMessageError, RetryableError } from '../../../src/common/errors.js';
import { BetEventsConsumer } from '../../../src/messaging/bet-events.consumer.js';
import { ROUTING_KEY_SETTLED } from '../../../src/messaging/topology.js';
import { fakeClassifier, fakeMetrics, fakeParking, fakeProcessor } from '../../support/fakes.js';
import { settledEvent } from '../../support/builders.js';

function message(routingKey = ROUTING_KEY_SETTLED, headers: unknown = {}): ConsumeMessage {
  return {
    fields: { routingKey, exchange: 'bets', deliveryTag: 1, redelivered: false },
    properties: { headers },
    content: Buffer.from(JSON.stringify(settledEvent())),
  } as unknown as ConsumeMessage;
}

function consumer(
  parts: {
    processor?: ReturnType<typeof fakeProcessor>;
    classifier?: ReturnType<typeof fakeClassifier>;
    parking?: ReturnType<typeof fakeParking>;
    metrics?: ReturnType<typeof fakeMetrics>;
  } = {},
) {
  const processor = parts.processor ?? fakeProcessor();
  const classifier = parts.classifier ?? fakeClassifier();
  const parking = parts.parking ?? fakeParking();
  const metrics = parts.metrics ?? fakeMetrics();

  return {
    subject: new BetEventsConsumer(processor, classifier, parking, metrics),
    processor,
    classifier,
    parking,
    metrics,
  };
}

describe('BetEventsConsumer', () => {
  it('acknowledges a handled delivery and counts it', async () => {
    const { subject, processor, parking, classifier, metrics } = consumer();
    processor.process.mockResolvedValue('scored');

    await expect(subject.handle(settledEvent(), message())).resolves.toBeUndefined();
    expect(metrics.recordAck).toHaveBeenCalledWith('scored');
    // Nothing to classify and nothing to park when the work simply succeeded.
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(parking.park).not.toHaveBeenCalled();
  });

  it('routes by the delivery’s routing key, not by anything in the body', async () => {
    const { subject, processor } = consumer();
    processor.process.mockResolvedValue('rolled_back');
    const payload = settledEvent();

    await subject.handle(payload, message('bet.rollback'));

    expect(processor.process).toHaveBeenCalledWith({ routingKey: 'bet.rollback', payload });
  });

  it('hands the classifier the attempt number from the headers', async () => {
    const { subject, processor, classifier } = consumer();
    const error = new RetryableError('db is down');
    processor.process.mockRejectedValue(error);
    classifier.classify.mockReturnValue({ kind: 'retry', attempt: 3, error });

    await subject.handle(
      settledEvent(),
      message(ROUTING_KEY_SETTLED, {
        'x-death': [{ queue: 'tournament.bets', reason: 'rejected', exchange: 'bets', count: 2 }],
      }),
    );

    expect(classifier.classify).toHaveBeenCalledWith({ error, attempt: 3 });
  });

  it('nacks without requeue on a retryable failure, so the TTL hop takes it', async () => {
    const { subject, processor, classifier, metrics } = consumer();
    const error = new RetryableError('db is down');
    processor.process.mockRejectedValue(error);
    classifier.classify.mockReturnValue({ kind: 'retry', attempt: 1, error });

    const result = await subject.handle(settledEvent(), message());

    expect(result).toBeInstanceOf(Nack);
    // Requeueing in place would redeliver instantly and burn every attempt in
    // milliseconds; the dead-letter route is what buys the delay.
    expect((result as Nack).requeue).toBe(false);
    expect(metrics.recordRetry).toHaveBeenCalledWith(1);
  });

  it('parks a poison message and then acknowledges it', async () => {
    const { subject, processor, classifier, parking, metrics } = consumer();
    const error = new PoisonMessageError('invalid_schema', 'bad payload');
    processor.process.mockRejectedValue(error);
    const outcome = { kind: 'park', reason: 'invalid_schema', attempts: 1, error } as const;
    classifier.classify.mockReturnValue(outcome);
    const delivery = message();

    const result = await subject.handle(settledEvent(), delivery);

    expect(parking.park).toHaveBeenCalledWith({ message: delivery, outcome });
    // Acknowledged, because the body is already safe in the parking queue;
    // nacking it would send it round the retry loop it can never survive.
    expect(result).toBeUndefined();
    expect(metrics.recordPark).toHaveBeenCalledWith('invalid_schema');
  });

  it('never acknowledges a message it failed to park', async () => {
    const { subject, processor, classifier, parking, metrics } = consumer();
    const error = new PoisonMessageError('invalid_schema', 'bad payload');
    processor.process.mockRejectedValue(error);
    classifier.classify.mockReturnValue({
      kind: 'park',
      reason: 'invalid_schema',
      attempts: 1,
      error,
    });
    parking.park.mockRejectedValue(new Error('broker refused the publish'));

    const result = await subject.handle(settledEvent(), message());

    // Acking here would drop the payload on the floor. Nacked, it goes round
    // the retry hop and the delivery limit eventually parks it for us.
    expect(result).toBeInstanceOf(Nack);
    expect(metrics.recordPark).not.toHaveBeenCalled();
  });

  it('records how long a delivery took, however it ended', async () => {
    const { subject, processor, classifier, metrics } = consumer();
    processor.process.mockResolvedValue('duplicate');
    await subject.handle(settledEvent(), message());

    const error = new RetryableError('db is down');
    processor.process.mockRejectedValue(error);
    classifier.classify.mockReturnValue({ kind: 'retry', attempt: 1, error });
    await subject.handle(settledEvent(), message());

    expect(metrics.observeProcessing).toHaveBeenCalledTimes(2);
  });
});
