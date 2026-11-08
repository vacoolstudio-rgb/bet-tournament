import { Decimal } from 'decimal.js';
import { NotImplementedError } from './not-implemented.error.js';

/**
 * Money and points arithmetic. Every number that represents value passes
 * through here, and none of it is a JavaScript `number`.
 *
 * Scales match the columns in the schema:
 *  - money   NUMERIC(20,4) — stake and winAmount as sent by the producer;
 *  - points  NUMERIC(20,6) — winAmount converted to USD, kept exact so that
 *    a rollback can subtract precisely what was added.
 */
export const MONEY_SCALE = 4;
export const POINTS_SCALE = 6;

/**
 * Upper bound for an incoming amount: NUMERIC(20,4) holds 16 integer digits,
 * and the conversion multiplies by a rate, so the bound is kept two orders
 * below the column's ceiling. An amount above this is a poison message, not a
 * database error — see AmountOutOfRangeError.
 */
export const MAX_MONEY_AMOUNT = '100000000000000'; // 1e14

/**
 * Shape of an acceptable money amount: up to 15 integer digits and up to
 * {@link MONEY_SCALE} fraction digits, no sign, no exponent.
 *
 * Exponent notation is rejected rather than parsed: `1e3` in a payload is far
 * more likely to be a producer bug than a deliberate 1000.
 */
export const MONEY_PATTERN = /^\d{1,15}(\.\d{1,4})?$/;

/**
 * Whether a raw payload value is an acceptable money amount.
 *
 * Shared by the DTO validator and by {@link parseMoney} so the rule has one
 * definition: a payload the validator accepted can never surprise the parser.
 */
export function isMoneyAmount(raw: unknown): boolean {
  if (typeof raw !== 'string' && typeof raw !== 'number') return false;
  if (typeof raw === 'number' && !Number.isFinite(raw)) return false;

  const text = typeof raw === 'number' ? String(raw) : raw.trim();
  if (!MONEY_PATTERN.test(text)) return false;

  return new Decimal(text).lte(MAX_MONEY_AMOUNT);
}

/**
 * Parses an amount from an event payload.
 *
 * The contract in the task does not say whether amounts arrive as JSON numbers
 * or as strings, so both are accepted; a string is preferred by the producer
 * because a JSON number is a float and 0.1 + 0.2 has no place near a balance.
 *
 * @throws AmountOutOfRangeError when the value is negative, not a finite
 *         decimal, carries more than {@link MONEY_SCALE} fraction digits, or
 *         exceeds {@link MAX_MONEY_AMOUNT}.
 */
export function parseMoney(_field: string, _raw: string | number): Decimal {
  throw new NotImplementedError('parseMoney');
}

/**
 * Parses an FX rate from the config. Rates are kept as strings all the way
 * from the environment for the same reason amounts are.
 */
export function parseRate(_currency: string, _raw: string): Decimal {
  throw new NotImplementedError('parseRate');
}

/**
 * Points for a settled bet: the won amount converted to USD.
 *
 * The result is exact to {@link POINTS_SCALE}; it is deliberately not rounded
 * to a whole point here. Rounding per event would drop fractions (ten wins of
 * 0.6 USD would score nothing) and would force the rollback path to reproduce
 * the same rounding to stay balanced.
 */
export function toPoints(_winAmount: Decimal, _rate: Decimal): Decimal {
  throw new NotImplementedError('toPoints');
}

/**
 * Whole points for the API: "1 point per 1 USD" as the task words it.
 * Truncates towards zero — a player is never credited a point they have not
 * fully earned.
 */
export function floorPoints(_points: Decimal | string): number {
  throw new NotImplementedError('floorPoints');
}

/** Formats a decimal for a NUMERIC column at a fixed scale. */
export function toColumn(_value: Decimal, _scale: number): string {
  throw new NotImplementedError('toColumn');
}
