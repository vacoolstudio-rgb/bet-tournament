import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // SIGTERM has to reach Nest's shutdown hooks, otherwise in-flight AMQP
  // messages are dropped mid-transaction instead of being nacked back.
  app.enableShutdownHooks();

  await app.listen(Number(process.env['PORT'] ?? 3000));
}

void bootstrap();
