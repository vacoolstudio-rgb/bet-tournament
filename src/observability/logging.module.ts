import { Module } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/config.module.js';

/** Endpoints a scraper and an orchestrator hit constantly. */
const UNLOGGED_PATHS = ['/health', '/metrics'];

/**
 * Structured logging, with the trace id on every line.
 *
 * The point is not the format for its own sake. This service is several
 * replicas consuming one queue, so "what happened to this bet" is a question
 * about lines written by different processes minutes apart — and answering it
 * by grepping text is the difference between a minute and an afternoon. With
 * `trace_id` as a field, the publish, the consume, the SQL and every log line
 * in between belong to one searchable trace.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.log.level,
          // Human-readable locally, one JSON object per line everywhere else.
          // A log collector cannot read columns, and a person cannot read JSON.
          ...(config.log.pretty
            ? {
                transport: {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'HH:MM:ss.l' },
                },
              }
            : {}),
          // Attached to every line, including the ones written inside a
          // consumer handler: the amqplib instrumentation makes the delivery's
          // span current, so a line logged while handling a bet carries the
          // trace that started where the event was published.
          mixin: () => {
            const span = trace.getActiveSpan();
            if (span === undefined) return {};

            const { traceId, spanId } = span.spanContext();

            return { trace_id: traceId, span_id: spanId };
          },
          autoLogging: {
            ignore: (request) =>
              UNLOGGED_PATHS.some((path) => (request.url ?? '').startsWith(path)),
          },
          // The header is trusted for identification and nothing else, but it
          // is still a player id: it belongs in a log the way an account
          // number does, which is to say not in the clear.
          redact: { paths: ['req.headers["x-player-id"]'], censor: '[redacted]' },
        },
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
