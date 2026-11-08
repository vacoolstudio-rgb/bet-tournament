/**
 * A tracer the tests can read back, installed before `amqplib` is imported.
 *
 * Deliberately not the production `tracing.ts`: that one starts a NodeSDK and
 * registers the global API, which cannot be done twice in a process, and it
 * exports to a collector nobody runs in CI. This registers the same two pieces
 * that make trace context cross a queue — the amqplib instrumentation and an
 * async-hooks context manager — against an in-memory exporter, so a test can
 * assert the shape of the trace instead of eyeballing it in a UI.
 *
 * Must be the **first import** of any spec that uses it: the instrumentation
 * patches `amqplib` as it is loaded, and ESM evaluates imports in source
 * order, so a spec that imports the broker first gets an unpatched library.
 */
import { AmqplibInstrumentation } from '@opentelemetry/instrumentation-amqplib';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import type { ReadableSpan } from '@opentelemetry/sdk-trace';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { context, propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

export const spans = new InMemorySpanExporter();

const provider = new TracerProvider({
  spanProcessors: [new SimpleSpanProcessor({ exporter: spans })],
});

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
trace.setGlobalTracerProvider(provider);
// Without this the API's propagator is a no-op: the publisher writes no
// `traceparent` header and the consumer starts a trace of its own. NodeSDK
// configures it for us in production; here it is set by hand.
propagation.setGlobalPropagator(new W3CTraceContextPropagator());

registerInstrumentations({
  instrumentations: [new AmqplibInstrumentation()],
  tracerProvider: provider,
});

export const tracer = provider.getTracer('tracing-probe');

/** Spans whose operation name contains `needle`, oldest first. */
export const spansNamed = (needle: string): readonly ReadableSpan[] =>
  spans.getFinishedSpans().filter((span) => span.name.includes(needle));
