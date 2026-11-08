// Must stay first: the instrumentations patch amqplib, pg and http as those
// modules load, and ESM evaluates imports in source order.
import './observability/tracing.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { APP_CONFIG } from './config/config.module.js';
import { ConfigurationError, loadConfig } from './config/app-config.js';
import type { AppConfig } from './config/app-config.js';

async function bootstrap(): Promise<void> {
  // Read before the framework starts, so a missing variable is a
  // configuration message rather than a stack trace under "Starting Nest
  // application...". The module re-reads it through its own provider; parsing
  // twice costs nothing and keeps the provider the single source for the rest
  // of the application.
  try {
    loadConfig();
  } catch (error) {
    console.error(error instanceof ConfigurationError ? error.message : error);
    process.exit(1);
  }

  // `bufferLogs` holds the framework's own startup lines until the logger is
  // installed, so they come out in the same format as everything else instead
  // of as Nest's columns followed by JSON.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  configureApp(app);

  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port);
}

void bootstrap();
