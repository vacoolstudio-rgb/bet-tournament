import { Inject, Injectable } from '@nestjs/common';
import { notImplemented } from '../common/not-implemented.error.js';
import {
  BETS_REPOSITORY,
  PLAYER_SCORES_REPOSITORY,
  UNIT_OF_WORK,
} from '../database/contracts/index.js';
import type {
  BetsRepositoryPort,
  PlayerScoresRepositoryPort,
  UnitOfWorkPort,
} from '../database/contracts/index.js';
import { FX_SERVICE, TOURNAMENT_SERVICE } from './scoring.contract.js';
import type {
  FxPort,
  RollbackBetCommand,
  RollbackOutcome,
  ScoringPort,
  SettleBetCommand,
  SettleOutcome,
  TournamentPort,
} from './scoring.contract.js';

@Injectable()
export class ScoringService implements ScoringPort {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(BETS_REPOSITORY) private readonly bets: BetsRepositoryPort,
    @Inject(PLAYER_SCORES_REPOSITORY) private readonly scores: PlayerScoresRepositoryPort,
    @Inject(FX_SERVICE) private readonly fx: FxPort,
    @Inject(TOURNAMENT_SERVICE) private readonly tournament: TournamentPort,
  ) {}

  /**
   * Scores a settled bet: one point per USD of `winAmount`.
   *
   * The journal insert and the aggregate update run in one transaction, and
   * the aggregate is credited only when the insert was new — that is what
   * makes a redelivered event a no-op. The points actually credited are stored
   * on the bet so a rollback can later subtract precisely that number.
   *
   * @throws UnknownCurrencyError when the currency has no configured rate.
   * @throws RetryableError when the database is unavailable.
   */
  settle(_command: SettleBetCommand): Promise<SettleOutcome> {
    return notImplemented(
      'ScoringService.settle',
      this.unitOfWork,
      this.bets,
      this.scores,
      this.fx,
      this.tournament,
    );
  }

  /**
   * Voids a bet, addressed only by `betId`.
   *
   * Subtracts the stored `points_awarded` rather than recomputing it — the
   * configured rate may have changed since the settle — and resets the
   * tie-break key to the player's remaining scoring bets. The command carries
   * no currency and no timestamp, so neither the FX config nor the tournament
   * window can affect the outcome.
   */
  rollback(_command: RollbackBetCommand): Promise<RollbackOutcome> {
    return notImplemented('ScoringService.rollback', this.unitOfWork, this.bets, this.scores);
  }
}
