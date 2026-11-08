import { PoisonMessageError } from '../../../src/common/errors.js';
import { isIsoTimestamp, parseTimestamp } from '../../../src/common/time.js';

describe('isIsoTimestamp', () => {
  it.each([
    ['UTC with Z', '2026-11-15T10:00:00.000Z'],
    ['lowercase z', '2026-11-15t10:00:00.000z'],
    ['no milliseconds', '2026-11-15T10:00:00Z'],
    ['a positive offset', '2026-11-15T13:00:00+03:00'],
    ['a negative offset', '2026-11-15T05:00:00-05:00'],
    ['nanosecond precision', '2026-11-15T10:00:00.123456789Z'],
    ['a leap day in a leap year', '2028-02-29T00:00:00Z'],
    ['the last second of a year', '2026-12-31T23:59:59Z'],
  ])('accepts %s', (_case, value) => {
    expect(isIsoTimestamp(value)).toBe(true);
  });

  it.each([
    // The one that matters: new Date('2026-11-15T10:00:00') is read in the
    // server's local zone, so the same payload falls inside the tournament
    // window on one host and outside it on another.
    ['a timestamp with no zone', '2026-11-15T10:00:00.000'],
    ['a timestamp with no zone and no millis', '2026-11-15T10:00:00'],
    ['a date without a time', '2026-11-15'],
    ['a space instead of T', '2026-11-15 10:00:00Z'],
    ['an impossible month', '2026-13-01T00:00:00Z'],
    // Date.parse accepts this one and rolls it over to 1 December, which would
    // turn a producer's off-by-one into a different scoring decision.
    ['a day the month does not have', '2026-11-31T00:00:00Z'],
    ['a leap day in a common year', '2027-02-29T00:00:00Z'],
    ['hour 24', '2026-11-15T24:00:00Z'],
    ['a leap second', '2026-11-15T23:59:60Z'],
    ['minute 60', '2026-11-15T10:60:00Z'],
    ['an offset without minutes', '2026-11-15T10:00:00+03'],
    ['free text', 'yesterday'],
    ['an empty string', ''],
    ['a number', 1_763_200_000_000],
    ['null', null],
  ])('rejects %s', (_case, value) => {
    expect(isIsoTimestamp(value)).toBe(false);
  });
});

describe('parseTimestamp', () => {
  it('returns the instant, independent of the host timezone', () => {
    expect(parseTimestamp('settledAt', '2026-11-15T13:00:00+03:00').toISOString()).toBe(
      '2026-11-15T10:00:00.000Z',
    );
  });

  it('rejects a timestamp without a zone as a poison payload', () => {
    expect(() => parseTimestamp('settledAt', '2026-11-15T10:00:00')).toThrow(PoisonMessageError);
  });

  it('reports the reason as a schema problem, not an amount problem', () => {
    try {
      parseTimestamp('settledAt', 'nonsense');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PoisonMessageError);
      expect((error as PoisonMessageError).reason).toBe('invalid_schema');
    }
  });
});
