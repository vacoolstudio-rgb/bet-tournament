import { Injectable } from '@nestjs/common';
import { Registry } from '@prometheus-io/client';
import type { PoisonReason } from '../common/errors.js';
import { notImplemented } from '../common/not-implemented.error.js';
import type { AckReason } from '../messaging/contracts/index.js';
import type { MetricsPort, MetricsSnapshot } from './metrics.contract.js';

/**
 * Own registry rather than the global default: two test suites in one process
 * would otherwise register the same collector twice and throw.
 */
@Injectable()
export class MetricsService implements MetricsPort {
  private readonly registry = new Registry();

  recordAck(_reason: AckReason): void {
    notImplemented('MetricsService.recordAck', this.registry);
  }

  recordRetry(_attempt: number): void {
    notImplemented('MetricsService.recordRetry', this.registry);
  }

  recordPark(_reason: PoisonReason | 'attempts_exhausted'): void {
    notImplemented('MetricsService.recordPark', this.registry);
  }

  observeProcessing(_seconds: number): void {
    notImplemented('MetricsService.observeProcessing', this.registry);
  }

  render(): Promise<MetricsSnapshot> {
    return notImplemented('MetricsService.render', this.registry);
  }
}
