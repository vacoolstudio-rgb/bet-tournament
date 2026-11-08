// The probe patches `amqplib`, so it has to be evaluated before anything that
// imports it — the broker, the harness, the helpers. Keep it first.
import { spansNamed, tracer } from './support/tracing-probe.js';
import { context, trace } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { connect } from 'amqplib';
import { inject } from 'vitest';
import { AmqpBroker } from '../../src/messaging/amqp-broker.js';
import { EXCHANGE_BETS, QUEUE_BETS, ROUTING_KEY_SETTLED } from '../../src/messaging/topology.js';
import { resetBroker, testConfig } from './support/app.js';
import type { Broker } from './support/broker.js';
import { settledEvent } from '../support/builders.js';

/**
 * Whether a trace survives the queue.
 *
 * This is the one observability property that cannot be checked by reading the
 * code: the publisher writes `traceparent` into the message headers, the
 * consumer's instrumentation reads it back and makes that context current for
 * the duration of its callback — and the service then hands the message to an
 * asynchronous handler, which is where an active context is lost by default.
 *
 * What it protects: a bet is handled by one of several replicas, minutes after
 * it was published, and "what happened to this bet" is answered by searching
 * one trace id across all of them. If the handler runs outside the delivery's
 * context, the SQL and the log lines get a trace of their own and the question
 * has no answer any more — while every test that only checks behaviour still
 * passes. Hence this one.
 */
let broker: Broker;
let amqp: AmqpBroker;

const handled: { traceId: string | undefined; parentSpanId: string | undefined }[] = [];

beforeAll(async () => {
  broker = await resetBroker();

  amqp = new AmqpBroker(testConfig());
  await amqp.onModuleInit();
  await amqp.consume(QUEUE_BETS, async () => {
    // Read after an await on purpose. The real handler resolves a rate, opens
    // a transaction and runs several statements, so what matters is the
    // context a continuation sees — not the one the first synchronous line
    // does, which survives even when the delivery context is not propagated
    // at all and would make this test pass while the service lost its traces.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const span = trace.getActiveSpan();
    handled.push({
      traceId: span?.spanContext().traceId,
      parentSpanId: span?.spanContext().spanId,
    });

    return 'ack' as const;
  });
}, 180_000);

afterAll(async () => {
  await amqp?.onApplicationShutdown();
  await broker?.close();
});

/** Publishes inside a span of our own, the way the producer does. */
async function publishInTrace(): Promise<{ traceId: string; publish: Span }> {
  const publish = tracer.startSpan('test publish');
  const traceId = publish.spanContext().traceId;

  await context.with(trace.setSpan(context.active(), publish), async () => {
    const connection = await connect(inject('amqpUrl'));
    const channel = await connection.createConfirmChannel();
    channel.publish(
      EXCHANGE_BETS,
      ROUTING_KEY_SETTLED,
      Buffer.from(JSON.stringify(settledEvent())),
      { persistent: true },
    );
    await channel.waitForConfirms();
    await channel.close();
    await connection.close();
  });

  publish.end();

  return { traceId, publish };
}

describe('trace context across the queue', () => {
  it('reaches the handler with the trace id the event was published under', async () => {
    handled.length = 0;

    const { traceId } = await publishInTrace();

    await vi.waitFor(() => expect(handled).toHaveLength(1), { timeout: 15_000, interval: 100 });

    // Not merely "some trace": the publisher's. A handler running in a fresh
    // root context would also report a trace id here, and it would be useless.
    expect(handled[0]?.traceId).toBe(traceId);
    // And a span is actually current, so a child span created by the pg
    // instrumentation has something to attach to.
    expect(handled[0]?.parentSpanId).toBeDefined();
  });

  it('builds one trace out of the publish and the consume', async () => {
    handled.length = 0;

    const { traceId, publish } = await publishInTrace();
    await vi.waitFor(() => expect(handled).toHaveLength(1), { timeout: 15_000, interval: 100 });

    const ofTrace = (needle: string) =>
      spansNamed(needle).filter((span) => span.spanContext().traceId === traceId);

    // The shape that makes a bet's journey readable: the caller's span, the
    // publish the instrumentation records inside it, and the consume in
    // another process hanging off that publish by way of the headers.
    const published = ofTrace(`publish ${EXCHANGE_BETS}`);
    const consumed = ofTrace(`${QUEUE_BETS} process`);

    expect(published).toHaveLength(1);
    expect(consumed).toHaveLength(1);
    expect(published[0]?.parentSpanContext?.spanId).toBe(publish.spanContext().spanId);
    // The link across the queue.
    expect(consumed[0]?.parentSpanContext?.spanId).toBe(published[0]?.spanContext().spanId);
    // And the span the handler saw is that consume span, not a sibling: a
    // query or a log line inside the handler becomes its child.
    expect(handled[0]?.parentSpanId).toBe(consumed[0]?.spanContext().spanId);
  });
});
