import { Injectable } from '@nestjs/common';
import { NotImplementedError } from '../common/not-implemented.error.js';
import type { BetRollbackEventDto, BetSettledEventDto } from '../messaging/dto/index.js';
import type { RollbackOutcome, SettleOutcome } from './scoring.outcome.js';

@Injectable()
export class ScoringService {
  /**
   * Scores a settled bet: one point per USD of `winAmount`.
   *
   * Runs the journal insert and the aggregate update in one transaction and
   * credits the aggregate only when the insert was new, which is what makes a
   * redelivered event a no-op. The points actually credited are stored on the
   * bet so a rollback can subtract precisely that number later.
   *
   * @throws UnknownCurrencyError when the currency has no configured rate.
   * @throws RetryableError when the database is unavailable.
   */
  settle(_event: BetSettledEventDto): Promise<SettleOutcome> {
    throw new NotImplementedError('ScoringService.settle');
  }

  /**
   * Voids a bet, addressed only by `betId`.
   *
   * Subtracts the stored `points_awarded` rather than recomputing it — the
   * configured rate may have changed since the settle — and resets the
   * tie-break key to the player's remaining scoring bets. Neither the FX
   * config nor the tournament window is consulted: both would be ways to
   * silently keep points for a bet that no longer counts.
   *
   * A rollback for an unknown bet writes a tombstone, so a late settle for it
   * scores nothing.
   */
  rollback(_event: BetRollbackEventDto): Promise<RollbackOutcome> {
    throw new NotImplementedError('ScoringService.rollback');
  }
}
