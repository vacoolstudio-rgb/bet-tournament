import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/config.module.js';
import { notImplemented } from '../common/not-implemented.error.js';
import type { FailureContext, FailureOutcome, OutcomeClassifierPort } from './contracts/index.js';

@Injectable()
export class OutcomeClassifier implements OutcomeClassifierPort {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  classify(_context: FailureContext): FailureOutcome {
    return notImplemented('OutcomeClassifier.classify', this.config);
  }
}
