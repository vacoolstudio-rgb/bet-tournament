import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/config.module.js';
import { notImplemented } from '../common/not-implemented.error.js';

/** The one currency whose rate is not configurable. */
export const BASE_CURRENCY = 'USD';

@Injectable()
export class FxService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * Units of USD per 1 unit of `currency`.
   *
   * USD is 1 by definition and is never read from the config: a configurable
   * identity is a configurable way to get it wrong.
   *
   * @throws UnknownCurrencyError when no rate is configured. Scoring the bet
   *         as zero would be worse — a player's winnings would vanish with no
   *         trace anywhere.
   */
  rateFor(_currency: string): Decimal {
    return notImplemented('FxService.rateFor', this.config);
  }

  /** Converts an amount in `currency` to USD. */
  toUsd(_amount: Decimal, _currency: string): Decimal {
    return notImplemented('FxService.toUsd', this.config);
  }
}
