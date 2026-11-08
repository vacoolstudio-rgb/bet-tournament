import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Everything that has to be true of a running application: validation,
 * API docs, and a shutdown that drains rather than drops.
 *
 * Shared by `main.ts` and by the integration tests on purpose — a test that
 * configures its own pipes is a test of a different application than the one
 * that ships.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      // `transform` is not cosmetic: it is what runs `@Type(() => Number)` on
      // the query string, so `?limit=2` arrives as a number and the bounds
      // actually apply.
      transform: true,
      // An unknown query parameter is dropped rather than rejected — a client
      // appending a tracking tag should not get a 400.
      whitelist: true,
    }),
  );

  // SIGTERM has to reach Nest's hooks, or an in-flight AMQP message is dropped
  // mid-transaction instead of being nacked back onto the queue.
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Bet Tournament')
      .setDescription(
        'Points for settled bets — one point per USD won, converted at the configured ' +
          'rate — and the tournament leaderboard.',
      )
      .setVersion('1.0')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
}
