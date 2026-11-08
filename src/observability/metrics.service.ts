import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Histogram, Registry } from '@prometheus-io/client';
import type { PoisonReason } from '../common/errors.js';
import type { AckReason } from '../messaging/contracts/index.js';
import { METRIC_NAMES } from './metrics.contract.js';
import type { HttpRequestOutcome, MetricsPort, MetricsSnapshot } from './metrics.contract.js';

/**
 * Own registry rather than the global default: two instances in one process —
 * which is what every integration test does — would otherwise register the
 * same collector twice and throw, with nothing in the error to connect it to
 * either test.
 */
@Injectable()
export class MetricsService implements MetricsPort {
  private readonly registry = new Registry();

  constructor() {
    // Heap, event loop lag, GC, file descriptors, CPU. Without these a leak or
    // a starved event loop is invisible from metrics, and the only way to see
    // either is to be logged into the box with `docker stats` — which is not a
    // way to run anything.
    collectDefaultMetrics({ register: this.registry });
  }

  private readonly acknowledged = new Counter({
    name: METRIC_NAMES.acknowledged,
    help: 'Deliveries handled and acknowledged, by why they were acknowledged.',
    labelNames: ['reason'],
    registers: [this.registry],
  });

  private readonly retried = new Counter({
    name: METRIC_NAMES.retried,
    help: 'Deliveries sent round the retry hop, by attempt number.',
    labelNames: ['attempt'],
    registers: [this.registry],
  });

  private readonly parked = new Counter({
    name: METRIC_NAMES.parked,
    help: 'Messages moved to the parking queue, by why they can never succeed.',
    labelNames: ['reason'],
    registers: [this.registry],
  });

  private readonly processing = new Histogram({
    name: METRIC_NAMES.processing,
    help: 'End-to-end handling time of one delivery, in seconds.',
    // A scored bet is one transaction; the tail is what a slow database or a
    // lock queue looks like.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly httpRequests = new Counter({
    name: METRIC_NAMES.httpRequests,
    help: 'Finished HTTP requests, by route, method and status.',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry],
  });

  private readonly httpDuration = new Histogram({
    name: METRIC_NAMES.httpDuration,
    help: 'HTTP request duration in seconds, by route and method.',
    labelNames: ['method', 'route'],
    // The leaderboard answers in single-digit milliseconds when the index is
    // doing its job, and in tens when it is not; the buckets have to separate
    // those two worlds.
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  recordAck(reason: AckReason): void {
    this.acknowledged.inc({ reason });
  }

  recordRetry(attempt: number): void {
    this.retried.inc({ attempt });
  }

  recordPark(reason: PoisonReason | 'attempts_exhausted'): void {
    this.parked.inc({ reason });
  }

  observeProcessing(seconds: number): void {
    this.processing.observe(seconds);
  }

  observeHttpRequest({ method, route, status, seconds }: HttpRequestOutcome): void {
    this.httpRequests.inc({ method, route, status });
    this.httpDuration.observe({ method, route }, seconds);
  }

  async render(): Promise<MetricsSnapshot> {
    return { contentType: this.registry.contentType, body: await this.registry.metrics() };
  }
}
