import type { INestApplication } from '@nestjs/common';
import { notImplemented } from './common/not-implemented.error.js';

/**
 * Everything that has to be true of a running application: validation,
 * serialisation, error shape, shutdown hooks, API docs.
 *
 * Shared by `main.ts` and by the integration tests on purpose — a test that
 * configures its own pipes is a test of a different application than the one
 * that ships.
 */
export function configureApp(_app: INestApplication): void {
  notImplemented('configureApp');
}
