import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Unit-test configuration.
 *
 * `unplugin-swc` is not optional for a Nest code base: Vitest transforms with
 * esbuild, and esbuild cannot emit `design:paramtypes`. Without SWC every
 * provider injected *by type* resolves to `undefined` and
 * `Test.createTestingModule` fails with "Nest can't resolve dependencies" —
 * in the tests only, which makes for a deeply confusing afternoon.
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
    include: ['test/unit/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    // Domain tests are pure and fast; isolate per file so a leaked singleton
    // in one suite cannot change the outcome of another.
    isolate: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        '**/index.ts',
        '**/*.module.ts',
        '**/*.contract.ts',
        '**/*.port.ts',
        'src/main.ts',
        'src/app.setup.ts',
        'src/database/migrations/**',
        'src/database/data-source.ts',
        '**/*.dto.ts',
        '**/*.entity.ts',
        // Covered by the integration suite, which runs under its own config
        // and reports separately. Left in, these read as near-zero and invite
        // someone to "fix" the number by unit-testing SQL against a mock —
        // which would assert that the mock agrees with itself.
        'src/database/repositories/**',
        'src/database/unit-of-work.ts',
        // The AMQP layer: a connection, a channel setup function and a consume
        // loop. The integration suite drives it for real, including severing
        // the connection to watch it recover; a unit test could only mock
        // amqplib and assert that the mock agrees with itself.
        'src/messaging/amqp-broker.ts',
        'src/health/**',
        'src/observability/metrics.controller.ts',
        'src/leaderboard/leaderboard.controller.ts',
      ],
      // `npm run test:cov` measures the unit suite only. The thresholds sit on
      // the code that suite is responsible for; the adapters are excluded
      // above rather than held to a number no unit test should be meeting.
      thresholds: {
        // Scoring and money are where the money logic lives; they carry the bar.
        'src/scoring/**': { statements: 90, branches: 80, functions: 90, lines: 90 },
        'src/common/**': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'src/messaging/**': { statements: 85, branches: 75, functions: 85, lines: 85 },
      },
    },
  },
});
