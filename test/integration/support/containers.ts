import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RabbitMQContainer } from '@testcontainers/rabbitmq';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string;
    amqpUrl: string;
    /** HTTP management API, used to read a queue's declared arguments. */
    managementUrl: string;
  }
}

/**
 * One Postgres and one RabbitMQ for the whole integration run.
 *
 * Booting them per file would be honest isolation and roughly a minute of
 * waiting; the suites keep themselves apart instead — each truncates the
 * tables it uses and names its queues after itself.
 *
 * The images are pinned to the same tags as docker-compose.yml: a test that
 * passes against a different major than production runs is a test that proves
 * something else.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [postgres, rabbit] = await Promise.all([
    new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('tournament')
      .withUsername('tournament')
      .withPassword('tournament')
      .start(),
    new RabbitMQContainer('rabbitmq:4-management-alpine')
      // The management API is the only way to read back the arguments a queue
      // was actually declared with.
      .withExposedPorts(5672, 15672)
      .start(),
  ]);

  project.provide('databaseUrl', postgres.getConnectionUri());
  project.provide('amqpUrl', rabbit.getAmqpUrl());
  project.provide('managementUrl', `http://${rabbit.getHost()}:${rabbit.getMappedPort(15672)}`);

  return async (): Promise<void> => {
    await Promise.all([postgres.stop(), rabbit.stop()]);
  };
}
