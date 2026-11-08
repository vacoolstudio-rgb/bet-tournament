import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/config.module.js';
import { BASE_CURRENCY } from '../common/currency.js';
import { UnknownCurrencyError } from '../common/errors.js';
import { parseRate } from '../common/money.js';
import type { ConvertToUsdInput, FxPort } from './scoring.contract.js';

@Injectable()
export class FxService implements FxPort {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  rateFor(currency: string): Decimal {
    // Checked before the config is consulted, not after: a stray USD entry
    // would otherwise rescale every dollar bet in the tournament, and the
    // schema's refusal to accept one is a safety net, not the rule.
    if (currency === BASE_CURRENCY) return new Decimal(1);

    const rate = this.config.fxRates[currency];
    if (rate === undefined) throw new UnknownCurrencyError(currency);

    return parseRate(currency, rate);
  }

  toUsd({ amount, currency }: ConvertToUsdInput): Decimal {
    return amount.mul(this.rateFor(currency));
  }
}
