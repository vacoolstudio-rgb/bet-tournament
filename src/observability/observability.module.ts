import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HttpMetricsInterceptor } from './http-metrics.interceptor.js';
import { MetricsController } from './metrics.controller.js';
import { METRICS } from './metrics.contract.js';
import { MetricsService } from './metrics.service.js';

/**
 * Global because the consumer, the scoring service and the HTTP layer all
 * record to the same registry, and threading it through every module's imports
 * would say nothing a reader does not already assume.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    { provide: METRICS, useClass: MetricsService },
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
  exports: [METRICS],
})
export class ObservabilityModule {}
