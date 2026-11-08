import { plainToInstance } from 'class-transformer';
import type { ClassConstructor } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BetRollbackEventDto, BetSettledEventDto } from '../../../src/messaging/dto/index.js';
import { rollbackEvent, settledEvent } from '../../support/builders.js';

/**
 * Exercises the decorators directly, so these pass today: the DTOs are the
 * part of validation that is declaration rather than logic. `validateEvent`
 * has its own spec for the wrapper that turns a failure into a parked message.
 */
function violations<T extends object>(dto: ClassConstructor<T>, payload: unknown): string[] {
  return validateSync(plainToInstance(dto, payload), { whitelist: true }).map(
    (error) => error.property,
  );
}

describe('BetSettledEventDto', () => {
  it('accepts the contract from the task', () => {
    expect(violations(BetSettledEventDto, settledEvent())).toEqual([]);
  });

  it('accepts amounts as JSON numbers as well as strings', () => {
    expect(violations(BetSettledEventDto, settledEvent({ stake: 10, winAmount: 10.4 }))).toEqual(
      [],
    );
  });

  it('accepts a losing bet', () => {
    expect(violations(BetSettledEventDto, settledEvent({ winAmount: '0' }))).toEqual([]);
  });

  it('accepts a crypto ticker', () => {
    expect(violations(BetSettledEventDto, settledEvent({ currency: 'USDT' }))).toEqual([]);
  });

  it('ignores a field the producer added later', () => {
    // Forward compatibility on purpose: a new field in the envelope must not
    // park every event until this service is redeployed.
    const payload = { ...settledEvent(), channel: 'mobile' };

    expect(violations(BetSettledEventDto, payload)).toEqual([]);
  });

  it.each([
    ['betId', { betId: undefined }],
    ['betId', { betId: 'bet-1' }],
    ['playerId', { playerId: '' }],
    ['playerId', { playerId: 42 }],
    ['currency', { currency: 'eur' }],
    ['currency', { currency: 'EU' }],
    ['currency', { currency: 'ABCDEFGHIJK' }],
    ['currency', { currency: undefined }],
    ['stake', { stake: undefined }],
    ['stake', { stake: '-1' }],
    ['winAmount', { winAmount: 'abc' }],
    ['winAmount', { winAmount: '1.00001' }],
    ['winAmount', { winAmount: -5 }],
    ['winAmount', { winAmount: undefined }],
    ['settledAt', { settledAt: '2026-11-15T10:00:00' }],
    ['settledAt', { settledAt: '2026-11-15' }],
    ['settledAt', { settledAt: undefined }],
  ])('rejects a bad %s', (field, override) => {
    expect(violations(BetSettledEventDto, settledEvent(override))).toContain(field);
  });
});

describe('BetRollbackEventDto', () => {
  it('needs only the identity', () => {
    expect(violations(BetRollbackEventDto, rollbackEvent())).toEqual([]);
  });

  it('accepts the full envelope the producer happens to send', () => {
    const payload = rollbackEvent({
      currency: 'EUR',
      stake: '10.0000',
      winAmount: '10.4000',
      settledAt: '2026-11-15T10:00:00.000Z',
    });

    expect(violations(BetRollbackEventDto, payload)).toEqual([]);
  });

  it.each([
    ['betId', { betId: undefined }],
    ['betId', { betId: 'not-a-uuid' }],
    ['playerId', { playerId: undefined }],
  ])('rejects a missing or malformed %s', (field, override) => {
    expect(violations(BetRollbackEventDto, rollbackEvent(override))).toContain(field);
  });

  it.each([
    ['currency', { currency: 'eur' }],
    ['winAmount', { winAmount: 'abc' }],
    ['settledAt', { settledAt: 'yesterday' }],
  ])('still validates %s when it is present', (field, override) => {
    // The fields are ignored for the decision, but a malformed one means the
    // producer is broken, and silence would hide that.
    expect(violations(BetRollbackEventDto, rollbackEvent(override))).toContain(field);
  });
});
