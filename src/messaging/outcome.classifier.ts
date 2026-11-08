import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/config.module.js';
import { notImplemented } from '../common/not-implemented.error.js';
import type { MessageOutcome } from './message-outcome.js';

/** The two outcomes a failure can produce. */
export type FailureOutcome = Extract<MessageOutcome, { kind: 'retry' | 'park' }>;

@Injectable()
export class OutcomeClassifier {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * Decides between another attempt and the parking lot.
   *
   * The rule is not "how bad does this look" but "can a later attempt
   * possibly differ": a malformed payload or a currency missing from the
   * config cannot, a database that is down can. Attempts past
   * `RABBITMQ_MAX_ATTEMPTS` are parked whatever the cause, so a permanently
   * broken dependency does not loop forever.
   */
  classify(_error: unknown, _attempt: number): FailureOutcome {
    return notImplemented('OutcomeClassifier.classify', this.config);
  }
}
