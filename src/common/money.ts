import { Decimal } from 'decimal.js';
import { AmountOutOfRangeError } from './errors.js';

/**
 * decimal.js defaults to 20 significant digits, and that is not enough here:
 * an amount carries up to 13 integer digits and 4 decimal places, a rate up to
 * 8, so their product can need 25. At the default the tail is rounded away
 * silently — and a rollback has to subtract exactly the number the settle
 * credited, not a number that was nearly it.
 *
 * Set on the shared constructor rather than on a clone, because a clone's
 * instances fail `instanceof Decimal` and this module's values travel through
 * the whole domain.
 */
Decimal.set({ precision: 40 });

/**
 * Money and points arithmetic. Every number that represents value passes
 * through here, and none of it is a JavaScript `number`.
 *
 * Scales match the columns in the schema:
 *  - money   NUMERIC(20,4) — stake and winAmount as sent by the producer;
 *  - rate    NUMERIC(20,8) — units of USD per 1 unit of the currency;
 *  - points  NUMERIC(20,6) — winAmount converted to USD, kept exact so a
 *            rollback can subtract precisely what was added.
 */
export const MONEY_SCALE = 4;
export const RATE_SCALE = 8;
export const POINTS_SCALE = 6;

/**
 * Bound for an incoming amount. NUMERIC(20,4) holds 16 integer digits, so this
 * is comfortably inside the column; it exists to reject a payload that is
 * obviously a producer bug rather than to protect the column.
 */
export const MAX_MONEY_AMOUNT = '1000000000000'; // 1e12

/** Bound for a configured rate. NUMERIC(20,8) holds 12 integer digits. */
export const MAX_FX_RATE = '1000000'; // 1e6

/**
 * The largest value `points_awarded` NUMERIC(20,6) can hold.
 *
 * This is the bound that actually matters, and it is checked on the *product*
 * rather than on its factors. An amount and a rate can both be individually
 * sane and still multiply into something the column cannot store — and the
 * failure mode of not checking is the worst one available: the overflow
 * surfaces as a driver error, gets classified as an infrastructure failure and
 * is retried forever instead of being parked once.
 */
export const MAX_POINTS = '99999999999999.999999';

/**
 * Shape of an acceptable money amount: up to 13 integer digits and up to
 * {@link MONEY_SCALE} fraction digits, no sign, no exponent.
 *
 * Exponent notation is rejected rather than parsed: `1e3` in a payload is far
 * more likely to be a producer bug than a deliberate 1000.
 */
export const MONEY_PATTERN = /^\d{1,13}(\.\d{1,4})?$/;

/** Shape of an acceptable FX rate: positive, up to {@link RATE_SCALE} digits. */
export const RATE_PATTERN = /^\d{1,7}(\.\d{1,8})?$/;

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

/** Whether a configured FX rate is acceptable: positive and within bounds. */
export function isFxRate(raw: unknown): boolean {
  if (typeof raw !== 'string' && typeof raw !== 'number') return false;
  if (typeof raw === 'number' && !Number.isFinite(raw)) return false;

  const text = typeof raw === 'number' ? String(raw) : raw.trim();
  if (!RATE_PATTERN.test(text)) return false;

  const rate = new Decimal(text);

  return rate.gt(0) && rate.lte(MAX_FX_RATE);
}

/**
 * Parses an amount from an event payload.
 *
 * The contract in the task does not say whether amounts arrive as JSON numbers
 * or as strings, so both are accepted; the producer sends strings, because a
 * JSON number is a float and 0.1 + 0.2 has no place near a balance.
 *
 * @throws AmountOutOfRangeError when the value is negative, not a finite
 *         decimal, carries more than {@link MONEY_SCALE} fraction digits, or
 *         exceeds {@link MAX_MONEY_AMOUNT}.
 */
export function parseMoney(field: string, raw: string | number): Decimal {
  if (!isMoneyAmount(raw)) {
    throw new AmountOutOfRangeError(
      field,
      String(raw),
      `is not a non-negative decimal with at most ${MONEY_SCALE} fraction digits ` +
        `and at most ${MAX_MONEY_AMOUNT}`,
    );
  }

  return new Decimal(typeof raw === 'number' ? String(raw) : raw.trim());
}

/**
 * Parses an FX rate from the config. Rates stay strings all the way from the
 * environment for the same reason amounts do.
 */
export function parseRate(currency: string, raw: string): Decimal {
  if (!isFxRate(raw)) {
    throw new AmountOutOfRangeError(
      `fxRate[${currency}]`,
      raw,
      `is not a positive decimal no greater than ${MAX_FX_RATE}`,
    );
  }

  return new Decimal(raw.trim());
}

/**
 * Points for a settled bet: the won amount converted to USD.
 *
 * Exact to {@link POINTS_SCALE}, deliberately not rounded to a whole point.
 * Rounding per event would drop fractions (ten wins of 0.6 USD would score
 * nothing) and would force the rollback path to reproduce the same rounding to
 * stay balanced.
 *
 * @throws AmountOutOfRangeError when the product exceeds {@link MAX_POINTS}.
 */
export function toPoints(winAmount: Decimal, rate: Decimal): Decimal {
  // Truncated, not rounded: the stored number and the credited number have to
  // be the same one, and rounding up would credit a micro-point nobody earned.
  const points = winAmount.mul(rate).toDecimalPlaces(POINTS_SCALE, Decimal.ROUND_DOWN);

  if (points.gt(MAX_POINTS)) {
    throw new AmountOutOfRangeError(
      'winAmount × fxRate',
      points.toFixed(POINTS_SCALE),
      `exceeds the largest value the points column can hold (${MAX_POINTS})`,
    );
  }

  return points;
}

/**
 * Whole points for the API: "1 point per 1 USD" as the task words it.
 * Truncates towards zero — a player is never credited a point they have not
 * fully earned. Safe as a `number`: {@link MAX_POINTS} is far below
 * `Number.MAX_SAFE_INTEGER`.
 */
export function floorPoints(points: Decimal | string): number {
  return new Decimal(points).toDecimalPlaces(0, Decimal.ROUND_DOWN).toNumber();
}

/** Formats a decimal for a NUMERIC column at a fixed scale. */
export function toColumn(value: Decimal, scale: number): string {
  return value.toFixed(scale, Decimal.ROUND_DOWN);
}
