import { Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { UnknownCurrencyError } from '../../../src/common/errors.js';
import { ScoringService } from '../../../src/scoring/scoring.service.js';
import type { FxPort } from '../../../src/scoring/scoring.contract.js';
import {
  ACTIVE_TOURNAMENT,
  fakeBetsRepository,
  fakeFx,
  fakePlayerScoresRepository,
  fakeScope,
  fakeTournament,
  fakeUnitOfWork,
} from '../../support/fakes.js';
import { BET_ID, OTHER_PLAYER_ID, PLAYER_ID, settleCommand } from '../../support/builders.js';

function fxSpy(rates?: Record<string, string>) {
  const real = fakeFx(rates);

  return {
    rateFor: vi.fn<FxPort['rateFor']>((currency) => real.rateFor(currency)),
    toUsd: vi.fn<FxPort['toUsd']>((input) => real.toUsd(input)),
  };
}

function subject(
  parts: {
    bets?: ReturnType<typeof fakeBetsRepository>;
    scores?: ReturnType<typeof fakePlayerScoresRepository>;
    fx?: ReturnType<typeof fxSpy>;
    tournament?: ReturnType<typeof fakeTournament>;
  } = {},
) {
  const unitOfWork = fakeUnitOfWork();
  const bets = parts.bets ?? fakeBetsRepository();
  const scores = parts.scores ?? fakePlayerScoresRepository();
  const fx = parts.fx ?? fxSpy();
  const tournament = parts.tournament ?? fakeTournament();

  return {
    service: new ScoringService(unitOfWork, bets, scores, fx, tournament),
    unitOfWork,
    bets,
    scores,
    fx,
    tournament,
  };
}

describe('ScoringService.settle', () => {
  it('scores one point per USD of the won amount', async () => {
    const { service, bets, scores } = subject();
    bets.insertSettled.mockResolvedValue('inserted');

    // 10.40 EUR at 1.08 is 11.232 USD.
    const outcome = await service.settle(settleCommand());

    expect(outcome).toEqual({ status: 'scored', pointsAwarded: '11.232000' });
    expect(scores.credit).toHaveBeenCalledWith({
      scope: fakeScope,
      tournamentId: ACTIVE_TOURNAMENT.id,
      playerId: PLAYER_ID,
      points: '11.232000',
      settledAt: settleCommand().settledAt,
    });
  });

  it('stores the rate it used and the points it credited', async () => {
    // Both are what makes the rollback exact later: it subtracts the stored
    // number instead of recomputing it from a config that may have changed.
    const { service, bets } = subject();
    bets.insertSettled.mockResolvedValue('inserted');

    await service.settle(settleCommand());

    expect(bets.insertSettled).toHaveBeenCalledWith({
      scope: fakeScope,
      bet: {
        tournamentId: ACTIVE_TOURNAMENT.id,
        betId: BET_ID,
        playerId: PLAYER_ID,
        currency: 'EUR',
        stake: '10.0000',
        winAmount: '10.4000',
        fxRate: '1.08000000',
        pointsAwarded: '11.232000',
        settledAt: settleCommand().settledAt,
      },
    });
  });

  it('credits nothing for a bet it has already journalled', async () => {
    const { service, bets, scores } = subject();
    bets.insertSettled.mockResolvedValue('duplicate');

    await expect(service.settle(settleCommand())).resolves.toEqual({ status: 'duplicate' });
    expect(scores.credit).not.toHaveBeenCalled();
  });

  it('credits nothing when a rollback got there first', async () => {
    const { service, bets, scores } = subject();
    bets.insertSettled.mockResolvedValue('tombstone_filled');

    await expect(service.settle(settleCommand())).resolves.toEqual({
      status: 'already_rolled_back',
    });
    expect(scores.credit).not.toHaveBeenCalled();
  });

  it('journals a losing bet and counts it, worth no points', async () => {
    // The row is needed for idempotency and for a later rollback, and the bet
    // still counts towards `betsCounted`.
    const { service, bets, scores } = subject();
    bets.insertSettled.mockResolvedValue('inserted');

    const outcome = await service.settle(settleCommand({ winAmount: new Decimal(0) }));

    expect(outcome).toEqual({ status: 'scored_zero' });
    expect(scores.credit).toHaveBeenCalledWith(
      expect.objectContaining({ points: '0.000000', playerId: PLAYER_ID }),
    );
  });

  it('ignores a bet settled outside the tournament window', async () => {
    const { service, bets, scores, unitOfWork } = subject({
      tournament: fakeTournament({ isWithinWindow: vi.fn(() => false) }),
    });

    await expect(service.settle(settleCommand())).resolves.toEqual({ status: 'out_of_window' });
    // Not an error and not a write: nothing is opened, nothing is journalled.
    expect(unitOfWork.withTransaction).not.toHaveBeenCalled();
    expect(bets.insertSettled).not.toHaveBeenCalled();
    expect(scores.credit).not.toHaveBeenCalled();
  });

  it('says in the log why an out-of-window bet scored nothing', async () => {
    // Otherwise the only trace is a counter in /metrics, and someone sending a
    // bet by hand against a window configured for another month sees nothing
    // at all and cannot tell why.
    const logged = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { service } = subject({
      tournament: fakeTournament({ isWithinWindow: vi.fn(() => false) }),
    });

    try {
      await service.settle(settleCommand());

      const line = String(logged.mock.calls[0]?.[0] ?? '');
      expect(line).toContain(BET_ID);
      // Both dates, because the mismatch between them is the answer.
      expect(line).toContain('2026-11-15T10:00:00.000Z');
      expect(line).toContain(ACTIVE_TOURNAMENT.startsAt.toISOString());
      expect(line).toContain(ACTIVE_TOURNAMENT.endsAt.toISOString());
    } finally {
      logged.mockRestore();
    }
  });

  it('checks the window before the rate, so an out-of-window bet is never parked', async () => {
    // A bet outside the window in a currency nobody configured is still just
    // out of scope, not a poison message.
    const { service, fx } = subject({
      tournament: fakeTournament({ isWithinWindow: vi.fn(() => false) }),
    });

    await service.settle(settleCommand({ currency: 'XYZ' }));

    expect(fx.rateFor).not.toHaveBeenCalled();
  });

  it('refuses to score a currency it has no rate for', async () => {
    const { service, unitOfWork } = subject({ fx: fxSpy({}) });

    // Not scored as zero: a player's winnings must not vanish without a
    // trace. The parked message names the currency.
    await expect(service.settle(settleCommand({ currency: 'XYZ' }))).rejects.toBeInstanceOf(
      UnknownCurrencyError,
    );
    expect(unitOfWork.withTransaction).not.toHaveBeenCalled();
  });

  it('lets a failure inside the transaction out, so nothing is half-written', async () => {
    // Swallowing this would commit the journal row without the points, and the
    // bet would then be a duplicate forever — scored nowhere and unscoreable.
    const { service, bets, scores } = subject();
    bets.insertSettled.mockResolvedValue('inserted');
    scores.credit.mockRejectedValue(new Error('deadlock detected'));

    await expect(service.settle(settleCommand())).rejects.toThrow('deadlock detected');
  });

  it('does the journal write and the credit in one transaction', async () => {
    const { service, bets, scores, unitOfWork } = subject();
    bets.insertSettled.mockResolvedValue('inserted');

    await service.settle(settleCommand());

    expect(unitOfWork.withTransaction).toHaveBeenCalledTimes(1);
    expect(bets.insertSettled.mock.calls[0]?.[0].scope).toBe(fakeScope);
    expect(scores.credit.mock.calls[0]?.[0].scope).toBe(fakeScope);
  });
});

describe('ScoringService.rollback', () => {
  it('subtracts exactly what the bet scored, not a recomputed amount', async () => {
    const { service, bets, scores } = subject();
    bets.markRolledBack.mockResolvedValue({ playerId: PLAYER_ID, pointsAwarded: '11.232000' });
    bets.latestScoringSettledAt.mockResolvedValue(new Date('2026-11-10T00:00:00.000Z'));

    const outcome = await service.rollback({ betId: BET_ID, playerId: PLAYER_ID });

    expect(outcome).toEqual({ status: 'rolled_back', pointsRemoved: '11.232000' });
    expect(scores.debit).toHaveBeenCalledWith({
      scope: fakeScope,
      tournamentId: ACTIVE_TOURNAMENT.id,
      playerId: PLAYER_ID,
      points: '11.232000',
      lastScoredAt: new Date('2026-11-10T00:00:00.000Z'),
    });
  });

  it('resets the tie-break key to null when no scoring bets remain', async () => {
    // Keeping the old value would leave the player sorted as though they had
    // scored at a moment that no longer counts.
    const { service, bets, scores } = subject();
    bets.markRolledBack.mockResolvedValue({ playerId: PLAYER_ID, pointsAwarded: '11.232000' });
    bets.latestScoringSettledAt.mockResolvedValue(null);

    await service.rollback({ betId: BET_ID, playerId: PLAYER_ID });

    expect(scores.debit).toHaveBeenCalledWith(expect.objectContaining({ lastScoredAt: null }));
  });

  it('believes the journal about who owns the bet, not the event', async () => {
    // If the two disagree, the settle is what credited the points, so the
    // rollback has to debit the same player or the balance walks away.
    const { service, bets, scores } = subject();
    bets.markRolledBack.mockResolvedValue({ playerId: PLAYER_ID, pointsAwarded: '5.000000' });
    bets.latestScoringSettledAt.mockResolvedValue(null);

    await service.rollback({ betId: BET_ID, playerId: OTHER_PLAYER_ID });

    expect(scores.debit).toHaveBeenCalledWith(expect.objectContaining({ playerId: PLAYER_ID }));
  });

  it('only drops the counted-bets tally when the bet scored nothing', async () => {
    const { service, bets, scores } = subject();
    bets.markRolledBack.mockResolvedValue({ playerId: PLAYER_ID, pointsAwarded: '0.000000' });

    const outcome = await service.rollback({ betId: BET_ID, playerId: PLAYER_ID });

    expect(outcome).toEqual({ status: 'rolled_back', pointsRemoved: '0.000000' });
    expect(scores.decrementCounted).toHaveBeenCalledWith({
      scope: fakeScope,
      tournamentId: ACTIVE_TOURNAMENT.id,
      playerId: PLAYER_ID,
    });
    expect(scores.debit).not.toHaveBeenCalled();
    // Nothing to recompute: the voided bet was not the tie-break key.
    expect(bets.latestScoringSettledAt).not.toHaveBeenCalled();
  });

  it('writes a tombstone when the settle has not arrived yet', async () => {
    const { service, bets, scores } = subject();
    bets.markRolledBack.mockResolvedValue(null);
    bets.insertTombstone.mockResolvedValue(true);

    const outcome = await service.rollback({ betId: BET_ID, playerId: PLAYER_ID });

    expect(outcome).toEqual({ status: 'tombstoned' });
    expect(bets.insertTombstone).toHaveBeenCalledWith({
      scope: fakeScope,
      tournamentId: ACTIVE_TOURNAMENT.id,
      betId: BET_ID,
      playerId: PLAYER_ID,
    });
    expect(scores.debit).not.toHaveBeenCalled();
    expect(scores.decrementCounted).not.toHaveBeenCalled();
  });

  it('voids a bet that got settled while it was deciding there was nothing to void', async () => {
    // The race acceptance found. An uncommitted insert is invisible to the
    // update rather than blocking it, so the rollback can see no settled bet,
    // then have its tombstone conflict with the settle that committed in
    // between. Reading that conflict as "already void" — which is what it
    // looks like — leaves the points credited forever.
    const { service, bets, scores } = subject();
    bets.markRolledBack
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ playerId: PLAYER_ID, pointsAwarded: '11.232000' });
    bets.insertTombstone.mockResolvedValue(false);
    bets.latestScoringSettledAt.mockResolvedValue(null);

    const outcome = await service.rollback({ betId: BET_ID, playerId: PLAYER_ID });

    expect(outcome).toEqual({ status: 'rolled_back', pointsRemoved: '11.232000' });
    expect(scores.debit).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: PLAYER_ID, points: '11.232000' }),
    );
  });

  it('treats a second rollback as a duplicate, not an error', async () => {
    const { service, bets, scores } = subject();
    // Null on both looks: the row exists and is already void, so neither the
    // first update nor the retry after the tombstone conflict finds anything.
    bets.markRolledBack.mockResolvedValue(null);
    bets.insertTombstone.mockResolvedValue(false);

    await expect(service.rollback({ betId: BET_ID, playerId: PLAYER_ID })).resolves.toEqual({
      status: 'duplicate',
    });
    expect(scores.debit).not.toHaveBeenCalled();
  });

  it('consults neither the rate table nor the tournament window', async () => {
    // The regression guard for the two ways a rollback could silently leave
    // points credited. The command cannot even carry a currency — this proves
    // nothing reaches for one behind its back.
    const { service, bets, fx, tournament } = subject();
    bets.markRolledBack.mockResolvedValue({ playerId: PLAYER_ID, pointsAwarded: '11.232000' });
    bets.latestScoringSettledAt.mockResolvedValue(null);

    await service.rollback({ betId: BET_ID, playerId: PLAYER_ID });

    expect(fx.rateFor).not.toHaveBeenCalled();
    expect(fx.toUsd).not.toHaveBeenCalled();
    expect(tournament.isWithinWindow).not.toHaveBeenCalled();
  });

  it('does the void and the debit in one transaction', async () => {
    const { service, bets, scores, unitOfWork } = subject();
    bets.markRolledBack.mockResolvedValue({ playerId: PLAYER_ID, pointsAwarded: '1.000000' });
    bets.latestScoringSettledAt.mockResolvedValue(null);

    await service.rollback({ betId: BET_ID, playerId: PLAYER_ID });

    expect(unitOfWork.withTransaction).toHaveBeenCalledTimes(1);
    expect(bets.markRolledBack.mock.calls[0]?.[0].scope).toBe(fakeScope);
    expect(scores.debit.mock.calls[0]?.[0].scope).toBe(fakeScope);
  });
});
