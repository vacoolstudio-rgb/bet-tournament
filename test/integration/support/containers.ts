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

/**
 * How long a container gets to become ready.
 *
 * The default is thirty seconds, which is generous on an idle machine and not
 * at all generous on a busy one — a laptop also running the compose stack, a
 * CI runner sharing a host. This covers the readiness wait: RabbitMQ's is a
 * log line, and waiting for it can take longer than half a minute under load.
 *
 * It does **not** cover the earlier phase, where Testcontainers polls Docker
 * until the container's ports are bound. That timeout is a hardcoded thirty
 * seconds in the library (`inspectContainerUntilPortsExposed`, no option
 * reaches it), and when it expires the whole run dies in global setup with
 * "Timed out after 30000ms while waiting for container ports to be bound to
 * the host" and no tests at all. Seen here while starting containers back to
 * back on a loaded Docker. If that happens, it is the machine and not the
 * suite: give Docker room and run it again.
 */
const STARTUP_TIMEOUT_MS = 180_000;
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [postgres, rabbit] = await Promise.all([
    new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('tournament')
      .withUsername('tournament')
      .withPassword('tournament')
      .withStartupTimeout(STARTUP_TIMEOUT_MS)
      .start(),
    new RabbitMQContainer('rabbitmq:4-management-alpine')
      // The management API is the only way to read back the arguments a queue
      // was actually declared with.
      .withExposedPorts(5672, 15672)
      .withStartupTimeout(STARTUP_TIMEOUT_MS)
      .start(),
  ]);

  project.provide('databaseUrl', postgres.getConnectionUri());
  project.provide('amqpUrl', rabbit.getAmqpUrl());
  project.provide('managementUrl', `http://${rabbit.getHost()}:${rabbit.getMappedPort(15672)}`);

  return async (): Promise<void> => {
    await Promise.all([postgres.stop(), rabbit.stop()]);
  };
}
