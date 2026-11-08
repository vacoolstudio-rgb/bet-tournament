import type { PoisonReason } from '../common/errors.js';
import type { AckReason } from '../messaging/contracts/index.js';

/**
 * The counters that make the consumer's behaviour observable.
 *
 * These are the questions an operator actually asks: are events being scored,
 * is anything being retried, is anything parked, and how long does one take.
 * `duplicate` and `tombstoned` are counted too — a spike in them is how a
 * producer replaying its log looks from the outside.
 */
export interface MetricsPort {
  /** One handled delivery, labelled by why it was acknowledged. */
  recordAck(reason: AckReason): void;

  /** One delivery sent round the retry hop, labelled by attempt number. */
  recordRetry(attempt: number): void;

  /** One message parked, labelled by the reason it can never succeed. */
  recordPark(reason: PoisonReason | 'attempts_exhausted'): void;

  /** End-to-end handling time of one delivery, in seconds. */
  observeProcessing(seconds: number): void;

  /** The scrape response: Prometheus text format and its exact content type. */
  render(): Promise<MetricsSnapshot>;
}

export interface MetricsSnapshot {
  /** e.g. `text/plain; version=0.0.4; charset=utf-8` — Prometheus is picky. */
  readonly contentType: string;
  readonly body: string;
}

export const METRICS = Symbol('MetricsPort');
