import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/config.module.js';
import { PoisonMessageError } from '../common/errors.js';
import type { FailureContext, FailureOutcome, OutcomeClassifierPort } from './contracts/index.js';

@Injectable()
export class OutcomeClassifier implements OutcomeClassifierPort {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  classify({ error, attempt }: FailureContext): FailureOutcome {
    // `throw 'oops'` happens, and the parking headers interpolate the error's
    // name and message.
    const cause = error instanceof Error ? error : new Error(`Non-error thrown: ${String(error)}`);

    // A poison message keeps its own reason even past the attempt budget: what
    // a human needs to read in the parking queue is "the payload is broken",
    // not "we gave up".
    if (error instanceof PoisonMessageError) {
      return { kind: 'park', reason: error.reason, attempts: attempt, error };
    }

    if (attempt >= this.config.rabbit.maxAttempts) {
      return { kind: 'park', reason: 'attempts_exhausted', attempts: attempt, error: cause };
    }

    // Anything unrecognised is assumed transient. Retrying something permanent
    // costs a few more deliveries; parking something transient loses a settled
    // bet.
    return { kind: 'retry', attempt, error: cause };
  }
}
