/**
 * OpenTelemetry, started before anything else.
 *
 * This module must be the **first import** of the process: the
 * instrumentations patch `amqplib`, `pg` and `http` as they are loaded, so a
 * module imported before the SDK starts is a module that never gets traced.
 * ESM evaluates imports depth-first in source order, which is why `main.ts`
 * imports this on its first line and why the import is bare.
 *
 * Nothing here reads the validated config: tracing has to work before the
 * configuration is parsed, and it must never be the reason a boot fails.
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { AmqplibInstrumentation } from '@opentelemetry/instrumentation-amqplib';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/** Flushes whatever is still buffered. Resolves even when tracing is off. */
export let shutdownTracing: () => Promise<void> = () => Promise.resolve();

const enabled = (process.env['OTEL_ENABLED'] ?? 'true') !== 'false';
const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

if (process.env['OTEL_DIAG'] === 'true') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
}

if (enabled) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env['OTEL_SERVICE_NAME'] ?? 'bet-tournament',
      [ATTR_SERVICE_VERSION]: process.env['npm_package_version'] ?? '1.0.0',
    }),
    // No endpoint means no collector, and that is a normal way to run: the
    // spans are still created and the trace context still propagates, so every
    // log line carries a trace id that ties a bet's whole journey together.
    // Pointing OTEL_EXPORTER_OTLP_ENDPOINT at a collector turns the same spans
    // into a trace somebody can look at.
    ...(endpoint === undefined
      ? {}
      : { traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }) }),
    instrumentations: [
      // The three that matter here, chosen rather than auto-loaded: the API in,
      // the broker across, the database at the bottom. Auto-instrumentation
      // would add a dozen patches for libraries this service does not use.
      new HttpInstrumentation({
        // Scrapes and probes would otherwise be most of the traces.
        ignoreIncomingRequestHook: (request) =>
          ['/health', '/metrics'].some((path) => (request.url ?? '').startsWith(path)),
      }),
      // amqplib carries `traceparent` in the message headers, which is how a
      // single trace spans a queue: the publisher's span and the consumer's
      // belong to the same trace even though they are in different processes.
      new AmqplibInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
    ],
  });

  sdk.start();

  shutdownTracing = async (): Promise<void> => {
    await sdk.shutdown().catch(() => undefined);
  };

  // Flushed on the way out, so the last trace of a shutting-down replica is
  // not the one that goes missing.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void shutdownTracing());
  }

  // And for the short-lived processes — the producer, the replay tool, the
  // migration runner — which finish their work and exit long before the batch
  // processor's timer would have sent anything. Without this their spans exist
  // only in a buffer that dies with the process, and a hand-published event
  // appears in no trace at all.
  process.once('beforeExit', () => void shutdownTracing());
}
