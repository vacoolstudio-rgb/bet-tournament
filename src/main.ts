import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
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

  const app = await NestFactory.create(AppModule);

  configureApp(app);

  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port);
}

void bootstrap();
