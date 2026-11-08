import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Integration configuration.
 *
 * These suites boot real Postgres and RabbitMQ containers through
 * Testcontainers, so they run serially with a generous timeout — the point is
 * to exercise transactions, row locks, DLX routing and message TTLs against
 * the real engines, which an in-memory fake cannot do.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
          useDefineForClassFields: false,
        },
        keepClassNames: true,
      },
    }),
  ],
  test: {
    globals: true,
    root: './',
    include: ['test/integration/**/*.spec.ts'],
    // Containers start once for the whole run and their URLs reach the workers
    // through `inject`.
    globalSetup: ['test/integration/support/containers.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Containers are expensive; one worker keeps port and resource usage sane.
    fileParallelism: false,
    pool: 'forks',
  },
});
