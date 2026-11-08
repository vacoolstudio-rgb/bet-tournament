/**
 * Currency codes.
 *
 * Wider than ISO-4217 on purpose: a betting platform settles in `USDT`,
 * `USDC` or `MATIC` as readily as in `EUR`, and a 3-letter-only contract would
 * park those as malformed — an unrecoverable outcome for a payload that is
 * perfectly valid. The rate table in `FX_RATES` decides what can actually be
 * scored, so the format only has to be wide enough not to lie.
 *
 * Still deliberately strict about case: a producer sending `eur` has a bug,
 * and normalising it silently would hide the bug while making the FX lookup
 * case-dependent.
 */
export const CURRENCY_PATTERN = /^[A-Z0-9]{3,10}$/;

/** Longest code the column holds; keep in step with the migration. */
export const CURRENCY_MAX_LENGTH = 10;

/** The one currency whose rate is not configurable: 1 by definition. */
export const BASE_CURRENCY = 'USD';

export function isCurrencyCode(raw: unknown): boolean {
  return typeof raw === 'string' && CURRENCY_PATTERN.test(raw);
}
