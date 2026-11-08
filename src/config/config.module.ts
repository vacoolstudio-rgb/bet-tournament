import { Global, Module } from '@nestjs/common';
import type { AppConfig } from './app-config.js';
import { loadConfig } from './app-config.js';

/** Injection token for {@link AppConfig}. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Global so that no feature module has to re-import configuration, and
 * value-provided so that a test can hand in a literal config object instead
 * of mutating `process.env`.
 */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
