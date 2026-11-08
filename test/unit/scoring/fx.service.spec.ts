import { Decimal } from 'decimal.js';
import { UnknownCurrencyError } from '../../../src/common/errors.js';
import { FxService } from '../../../src/scoring/fx.service.js';
import { fakeConfig } from '../../support/fakes.js';

const fx = new FxService(fakeConfig());

describe('FxService.rateFor', () => {
  it('returns 1 for USD without consulting the config', () => {
    // A configurable identity is a configurable way to get it wrong, so USD is
    // not in FX_RATES at all.
    expect(fx.rateFor('USD').toString()).toBe('1');
  });

  it('returns the configured rate as an exact decimal', () => {
    expect(fx.rateFor('EUR').toString()).toBe('1.08');
    expect(fx.rateFor('UAH').toString()).toBe('0.024');
  });

  it('refuses a currency with no configured rate', () => {
    // Returning zero would score the bet as nothing and lose a player's
    // winnings silently; this failure is visible in the parking queue.
    expect(() => fx.rateFor('XYZ')).toThrow(UnknownCurrencyError);
  });

  it('names the currency in the error, so the parked message is actionable', () => {
    try {
      fx.rateFor('XYZ');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as UnknownCurrencyError).currency).toBe('XYZ');
      expect((error as UnknownCurrencyError).reason).toBe('unknown_currency');
    }
  });

  it('ignores a USD entry even if one reaches the config', () => {
    // The schema rejects it, but the service must not depend on that: a stray
    // USD rate would silently rescale every dollar bet in the tournament.
    const stray = new FxService(fakeConfig({ fxRates: { USD: '2', EUR: '1.08' } }));

    expect(stray.rateFor('USD').toString()).toBe('1');
    expect(stray.toUsd({ amount: new Decimal('10'), currency: 'USD' }).toString()).toBe('10');
  });

  it('is case sensitive, because a lowercase code is a producer bug', () => {
    expect(() => fx.rateFor('eur')).toThrow(UnknownCurrencyError);
  });
});

describe('FxService.toUsd', () => {
  it('converts with decimal arithmetic, not floating point', () => {
    expect(fx.toUsd({ amount: new Decimal('10.40'), currency: 'EUR' }).toString()).toBe('11.232');
  });

  it('leaves a USD amount untouched', () => {
    expect(fx.toUsd({ amount: new Decimal('25.5'), currency: 'USD' }).toString()).toBe('25.5');
  });

  it('converts zero to zero', () => {
    expect(fx.toUsd({ amount: new Decimal(0), currency: 'EUR' }).isZero()).toBe(true);
  });

  it('keeps precision a float would lose', () => {
    // 0.1 + 0.2 territory: three conversions of 0.1 EUR must come to exactly
    // 0.324 USD.
    const once = fx.toUsd({ amount: new Decimal('0.1'), currency: 'EUR' });

    expect(once.mul(3).toString()).toBe('0.324');
  });

  it('refuses an unconfigured currency here too', () => {
    expect(() => fx.toUsd({ amount: new Decimal(1), currency: 'XYZ' })).toThrow(
      UnknownCurrencyError,
    );
  });
});
