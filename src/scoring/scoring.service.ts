import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { MONEY_SCALE, POINTS_SCALE, RATE_SCALE, toColumn, toPoints } from '../common/money.js';
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
  async settle(command: SettleBetCommand): Promise<SettleOutcome> {
    // The window first, and the rate only after. A bet settled outside the
    // tournament in a currency nobody configured is out of scope, not a poison
    // message: resolving the rate first would park it and invent manual work
    // out of nothing.
    if (!this.tournament.isWithinWindow(command.settledAt)) {
      return { status: 'out_of_window' };
    }

    const { id: tournamentId } = this.tournament.getActive();
    const rate = this.fx.rateFor(command.currency);
    const points = toPoints(command.winAmount, rate);
    const pointsAwarded = toColumn(points, POINTS_SCALE);

    return this.unitOfWork.withTransaction(async (scope) => {
      const written = await this.bets.insertSettled({
        scope,
        bet: {
          tournamentId,
          betId: command.betId,
          playerId: command.playerId,
          currency: command.currency,
          stake: toColumn(command.stake, MONEY_SCALE),
          winAmount: toColumn(command.winAmount, MONEY_SCALE),
          // Stored so the rollback subtracts what was credited rather than
          // what today's config would compute.
          fxRate: toColumn(rate, RATE_SCALE),
          pointsAwarded,
          settledAt: command.settledAt,
        },
      });

      if (written === 'duplicate') return { status: 'duplicate' };
      if (written === 'tombstone_filled') return { status: 'already_rolled_back' };

      // A losing bet is credited too: zero points, but it counts as a bet.
      await this.scores.credit({
        scope,
        tournamentId,
        playerId: command.playerId,
        points: pointsAwarded,
        settledAt: command.settledAt,
      });

      return points.isZero() ? { status: 'scored_zero' } : { status: 'scored', pointsAwarded };
    });
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
  async rollback(command: RollbackBetCommand): Promise<RollbackOutcome> {
    const { id: tournamentId } = this.tournament.getActive();

    return this.unitOfWork.withTransaction(async (scope) => {
      let voided = await this.bets.markRolledBack({
        scope,
        tournamentId,
        betId: command.betId,
      });

      if (voided === null) {
        const tombstoned = await this.bets.insertTombstone({
          scope,
          tournamentId,
          betId: command.betId,
          playerId: command.playerId,
        });

        if (tombstoned) return { status: 'tombstoned' };

        // The tombstone hit a row that was not there a statement ago, and
        // there is only one way that happens: the settle committed while this
        // transaction was deciding there was nothing to void. Its insert was
        // invisible to the update — an uncommitted row is not found, it does
        // not block — and by the time the tombstone conflicted, the points had
        // been credited.
        //
        // So look again. Under read committed the next statement sees a fresh
        // snapshot, and one retry is enough: the row is committed now, and it
        // is either settled (void it) or already void (a genuine duplicate).
        // Treating the conflict as a duplicate, which is what it looks like,
        // would leave those points credited forever.
        voided = await this.bets.markRolledBack({
          scope,
          tournamentId,
          betId: command.betId,
        });

        if (voided === null) return { status: 'duplicate' };
      }

      // The journal decides whose points these were. If the event disagrees,
      // the settle is what credited them, and debiting anyone else would walk
      // the balance away from both players.
      const playerId = voided.playerId;
      const pointsRemoved = voided.pointsAwarded;

      if (new Decimal(pointsRemoved).isZero()) {
        await this.scores.decrementCounted({ scope, tournamentId, playerId });

        return { status: 'rolled_back', pointsRemoved };
      }

      // Recomputed from the bets that still count — the voided one is already
      // out of `settled` by now, so it cannot contribute.
      const lastScoredAt = await this.bets.latestScoringSettledAt({
        scope,
        tournamentId,
        playerId,
      });

      await this.scores.debit({
        scope,
        tournamentId,
        playerId,
        points: pointsRemoved,
        lastScoredAt,
      });

      return { status: 'rolled_back', pointsRemoved };
    });
  }
}
