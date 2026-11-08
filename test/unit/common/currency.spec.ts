import { BASE_CURRENCY, isCurrencyCode } from '../../../src/common/currency.js';

describe('isCurrencyCode', () => {
  it.each([
    ['a fiat code', 'EUR'],
    ['the base currency', 'USD'],
    ['a stablecoin ticker', 'USDT'],
    ['a longer token ticker', 'MATIC'],
    ['a code with digits', 'W3B'],
    ['the maximum length', 'ABCDEFGHIJ'],
  ])('accepts %s', (_case, value) => {
    expect(isCurrencyCode(value)).toBe(true);
  });

  it.each([
    ['too short', 'EU'],
    ['too long', 'ABCDEFGHIJK'],
    // Strict on case deliberately: a producer sending "eur" has a bug, and
    // normalising it here would hide the bug and make the rate lookup
    // case-dependent.
    ['lowercase', 'eur'],
    ['mixed case', 'Eur'],
    ['a separator', 'EU-R'],
    ['whitespace', 'EUR '],
    ['an empty string', ''],
    ['null', null],
    ['a number', 978],
  ])('rejects %s', (_case, value) => {
    expect(isCurrencyCode(value)).toBe(false);
  });
});

describe('BASE_CURRENCY', () => {
  it('is USD, which is the one rate that is never configurable', () => {
    expect(BASE_CURRENCY).toBe('USD');
  });
});
