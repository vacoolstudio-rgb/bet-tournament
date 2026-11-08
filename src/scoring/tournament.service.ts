import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { NotImplementedError } from '../common/not-implemented.error.js';

export interface ActiveTournament {
  readonly id: string;
  readonly code: string;
  /** Inclusive. */
  readonly startsAt: Date;
  /** Exclusive. */
  readonly endsAt: Date;
}

@Injectable()
export class TournamentService implements OnModuleInit {
  /**
   * Makes the configured tournament exist and caches it.
   *
   * The window lives in the config and the row is upserted from it on every
   * boot, so there is exactly one source of truth. Already-scored points are
   * never recomputed when the window moves.
   */
  onModuleInit(): Promise<void> {
    throw new NotImplementedError('TournamentService.onModuleInit');
  }

  /** @throws Error when called before the module finished initialising. */
  getActive(): ActiveTournament {
    throw new NotImplementedError('TournamentService.getActive');
  }

  /**
   * Whether a settled bet falls inside the tournament.
   *
   * `startsAt` is inclusive and `endsAt` is exclusive, so two adjacent
   * tournaments cannot both count the same bet.
   *
   * Only ever consulted for `bet.settled`. Filtering rollbacks by the window
   * would silently keep points for a bet that was voided outside it.
   */
  isWithinWindow(_settledAt: Date): boolean {
    throw new NotImplementedError('TournamentService.isWithinWindow');
  }
}
