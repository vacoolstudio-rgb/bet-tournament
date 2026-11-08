import { IsUUID, Matches } from 'class-validator';
import type { BetSettledEvent } from '../contracts/index.js';
import { IsIsoTimestamp } from './is-iso-timestamp.decorator.js';
import { IsMoneyAmount } from './is-money-amount.decorator.js';

/**
 * Validator for `bet.settled`.
 *
 * The shape itself lives in {@link BetSettledEvent}; this class is that
 * contract plus the rules that decide whether a payload may enter the domain.
 */
export class BetSettledEventDto implements BetSettledEvent {
  @IsUUID()
  betId: string;

  @IsUUID()
  playerId: string;

  /**
   * Validated as a 3-letter code rather than against the ISO-4217 list: the
   * set of currencies that can be scored is whatever `FX_RATES` says, and a
   * gambling platform may well settle in something the list has never heard
   * of. An unknown code is rejected later, by the FX lookup, with a reason.
   */
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter uppercase code' })
  currency: string;

  /** Kept for audit; it does not take part in scoring. */
  @IsMoneyAmount()
  stake: string | number;

  /** What the player won. This, converted to USD, is the score. */
  @IsMoneyAmount()
  winAmount: string | number;

  /** Decides whether the bet falls inside the tournament window. */
  @IsIsoTimestamp()
  settledAt: string;
}
