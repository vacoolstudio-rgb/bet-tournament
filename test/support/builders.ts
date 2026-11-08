import { Decimal } from 'decimal.js';
import type { BetRollbackEvent, BetSettledEvent } from '../../src/messaging/contracts/index.js';
import type { SettleBetCommand } from '../../src/scoring/scoring.contract.js';

export const BET_ID = '22222222-2222-4222-8222-222222222222';
export const PLAYER_ID = '33333333-3333-4333-8333-333333333333';
export const OTHER_PLAYER_ID = '44444444-4444-4444-8444-444444444444';
export const SECOND_BET_ID = '66666666-6666-4666-8666-666666666666';
export const THIRD_BET_ID = '77777777-7777-4777-8777-777777777777';

/** Inside the fake tournament window. */
export const SETTLED_AT = '2026-11-15T10:00:00.000Z';

/**
 * Overrides are `unknown`-valued on purpose: half the tests build a payload
 * that is deliberately invalid — a missing field, a number where a string
 * belongs — and a `Partial<BetSettledEvent>` cannot express those at all under
 * `exactOptionalPropertyTypes`.
 */
type PayloadOverrides = Readonly<Record<string, unknown>>;

export function settledEvent(overrides: PayloadOverrides = {}): BetSettledEvent {
  return {
    betId: BET_ID,
    playerId: PLAYER_ID,
    currency: 'EUR',
    stake: '10.0000',
    winAmount: '10.4000',
    settledAt: SETTLED_AT,
    ...overrides,
  };
}

export function rollbackEvent(overrides: PayloadOverrides = {}): BetRollbackEvent {
  return {
    betId: BET_ID,
    playerId: PLAYER_ID,
    ...overrides,
  };
}

export function settleCommand(overrides: Partial<SettleBetCommand> = {}): SettleBetCommand {
  return {
    betId: BET_ID,
    playerId: PLAYER_ID,
    currency: 'EUR',
    stake: new Decimal('10'),
    winAmount: new Decimal('10.4'),
    settledAt: new Date(SETTLED_AT),
    ...overrides,
  };
}
