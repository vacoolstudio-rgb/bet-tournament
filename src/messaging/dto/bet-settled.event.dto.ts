import { IsUUID, Matches } from 'class-validator';
import { CURRENCY_PATTERN } from '../../common/currency.js';
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
   * Validated for shape, not against the ISO-4217 list: what can actually be
   * scored is whatever `FX_RATES` says, and an unconfigured code is rejected
   * later by the FX lookup, with a reason in the parking headers.
   *
   * @see CURRENCY_PATTERN for why the shape is wider than three letters.
   */
  @Matches(CURRENCY_PATTERN, {
    message: 'currency must be 3 to 10 uppercase letters or digits',
  })
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
