import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from 'decimal.js';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/config.module.js';
import { notImplemented } from '../common/not-implemented.error.js';
import type { ConvertToUsdInput, FxPort } from './scoring.contract.js';

@Injectable()
export class FxService implements FxPort {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  rateFor(_currency: string): Decimal {
    return notImplemented('FxService.rateFor', this.config);
  }

  toUsd(_input: ConvertToUsdInput): Decimal {
    return notImplemented('FxService.toUsd', this.config);
  }
}
