import { PoisonMessageError } from '../../../src/common/errors.js';
import { BetRollbackEventDto, BetSettledEventDto } from '../../../src/messaging/dto/index.js';
import { validateEvent } from '../../../src/messaging/validate-event.js';
import { rollbackEvent, settledEvent } from '../../support/builders.js';

describe('validateEvent', () => {
  it('returns a DTO instance for a valid payload', () => {
    const event = validateEvent({ dto: BetSettledEventDto, payload: settledEvent() });

    expect(event).toBeInstanceOf(BetSettledEventDto);
    expect(event.winAmount).toBe('10.4000');
  });

  it('keeps an amount in the shape it arrived in', () => {
    // Converting here would hide which shape the producer used, and the
    // parsing belongs in one place: the money module.
    const event = validateEvent({ dto: BetSettledEventDto, payload: settledEvent({ stake: 10 }) });

    expect(event.stake).toBe(10);
  });

  it('strips a field the contract does not know', () => {
    const event = validateEvent({
      dto: BetSettledEventDto,
      payload: { ...settledEvent(), channel: 'mobile' },
    });

    expect(event).not.toHaveProperty('channel');
  });

  it('validates a rollback with only its identity', () => {
    const event = validateEvent({ dto: BetRollbackEventDto, payload: rollbackEvent() });

    expect(event.betId).toBe(rollbackEvent().betId);
  });

  it.each([
    ['a missing field', { winAmount: undefined }],
    ['a malformed id', { betId: 'bet-1' }],
    ['a timestamp without a zone', { settledAt: '2026-11-15T10:00:00' }],
  ])('rejects %s as poison', (_case, override) => {
    expect(() =>
      validateEvent({ dto: BetSettledEventDto, payload: settledEvent(override) }),
    ).toThrow(PoisonMessageError);
  });

  it.each([
    ['a string body', 'not an object'],
    ['a number body', 42],
    ['null', null],
    ['an array', [settledEvent()]],
    // What the subscription actually hands over when the body is not JSON:
    // `allowNonJsonMessages` passes the raw buffer through rather than
    // throwing inside the library, where there would be no reason to attach.
    ['a raw buffer', Buffer.from('{not json')],
    ['an empty buffer', Buffer.alloc(0)],
  ])('rejects %s as poison', (_case, payload) => {
    expect(() => validateEvent({ dto: BetSettledEventDto, payload })).toThrow(PoisonMessageError);
  });

  it('parks a body nested deeply enough to overflow the stack', () => {
    // Found by fuzzing the live service. class-transformer recurses into the
    // structure, so a deep enough body throws RangeError instead of returning
    // validation failures — and an error escaping from here is read as
    // infrastructure, which sends a message that can never be read round the
    // retry hop for its entire budget.
    const deep = JSON.parse(`${'['.repeat(5_000)}${']'.repeat(5_000)}`) as unknown;

    try {
      validateEvent({ dto: BetSettledEventDto, payload: { ...settledEvent(), junk: deep } });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PoisonMessageError);
      expect((error as PoisonMessageError).reason).toBe('invalid_schema');
    }
  });

  it('classifies the failure as a schema problem and names the fields', () => {
    try {
      validateEvent({ dto: BetSettledEventDto, payload: settledEvent({ currency: 'eur' }) });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PoisonMessageError);
      expect((error as PoisonMessageError).reason).toBe('invalid_schema');
      // The parked message has to say what was wrong; "invalid" alone sends a
      // human back to the payload to guess.
      expect(JSON.stringify((error as PoisonMessageError).details)).toContain('currency');
    }
  });
});
