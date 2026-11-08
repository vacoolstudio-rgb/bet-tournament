import { IsISO8601, IsUUID, Matches } from 'class-validator';
import { IsMoneyAmount } from './is-money-amount.decorator.js';

/**
 * `bet.settled` — the event that scores points.
 *
 * The field set is exactly the contract given in the task; nothing was added,
 * because a consumer that requires a field the producer does not send is a
 * consumer that rejects every message.
 */
export class BetSettledEventDto {
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
  @IsISO8601({ strict: true })
  settledAt: string;
}
