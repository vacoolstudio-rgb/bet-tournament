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
        'src/main.ts',
        'src/database/migrations/**',
        'src/database/data-source.ts',
        '**/*.dto.ts',
        '**/*.entity.ts',
      ],
      thresholds: {
        // Scoring is where the money logic lives; it carries the bar.
        'src/scoring/**': { statements: 90, branches: 80, functions: 90, lines: 90 },
      },
    },
  },
});
