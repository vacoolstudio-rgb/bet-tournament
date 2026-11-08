import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';
import type { BetRollbackEvent } from '../contracts/index.js';
import { IsMoneyAmount } from './is-money-amount.decorator.js';

/**
 * `bet.rollback` — the event that voids a bet.
 *
 * Only the identity is required. The amounts, the currency and the timestamp
 * are accepted because the producer sends the same envelope, but they take no
 * part in the decision, and that is a correctness requirement rather than a
 * simplification:
 *
 *  - resolving the FX rate here would park a legitimate rollback whenever its
 *    currency had been dropped from the config, leaving the points credited;
 *  - checking the tournament window here would ignore a rollback whose
 *    `settledAt` falls outside it, leaving the points credited.
 *
 * How much to subtract is known from the journal, not from this payload.
 */
export class BetRollbackEventDto implements BetRollbackEvent {
  @IsUUID()
  betId: string;

  /** Used for logs and for the tombstone when the settle has not arrived yet. */
  @IsUUID()
  playerId: string;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter uppercase code' })
  currency?: string;

  @IsOptional()
  @IsMoneyAmount()
  stake?: string | number;

  @IsOptional()
  @IsMoneyAmount()
  winAmount?: string | number;

  @IsOptional()
  @IsISO8601({ strict: true })
  settledAt?: string;
}
