import type { RollbackBetCommand } from '../../../src/scoring/scoring.contract.js';
import type { VoidedBet } from '../../../src/database/contracts/index.js';
import { BET_ID, PLAYER_ID } from '../../support/builders.js';

/**
 * What a rollback is *not allowed to know*, enforced by the compiler.
 *
 * A rollback subtracts the `points_awarded` stored on the bet instead of
 * recomputing win × rate, because the configured rate may have changed between
 * the two events — recompute and the difference stays behind forever as points
 * nobody won. An integration test demonstrates that end to end, but the real
 * protection is that recomputation is inexpressible: neither the command nor
 * the repository's answer carries a currency, an amount or a time.
 *
 * The careless refactor this guards against is a reasonable-looking one —
 * "the journal row has the currency, let's just recompute" — and it begins by
 * widening one of these two types. The `@ts-expect-error` lines below fail the
 * typecheck the moment that happens, because the error they expect disappears.
 */
describe('the rollback contract', () => {
  it('carries no currency, amount or time', () => {
    const command: RollbackBetCommand = { betId: BET_ID, playerId: PLAYER_ID };

    // @ts-expect-error a currency here is the first step towards recomputing
    const withCurrency: RollbackBetCommand = { ...command, currency: 'EUR' };
    // @ts-expect-error and a time is the first step towards re-checking the window
    const withTime: RollbackBetCommand = { ...command, settledAt: new Date() };

    expect(command.betId).toBe(BET_ID);
    expect(withCurrency).toBeDefined();
    expect(withTime).toBeDefined();
  });

  it('is answered with the stored points and nothing to recompute from', () => {
    const voided: VoidedBet = { playerId: PLAYER_ID, pointsAwarded: '11.232000' };

    // @ts-expect-error the win amount would let the service recompute
    const withWin: VoidedBet = { ...voided, winAmount: '10.4000' };
    // @ts-expect-error as would the rate it was scored at
    const withRate: VoidedBet = { ...voided, fxRate: '1.08' };

    expect(voided.pointsAwarded).toBe('11.232000');
    expect(withWin).toBeDefined();
    expect(withRate).toBeDefined();
  });
});
