import { notImplemented } from './not-implemented.error.js';

/**
 * ISO-8601 instant with an explicit zone — `Z` or `±hh:mm`.
 *
 * The zone is mandatory, and that is not pedantry. `new Date('2026-11-08T10:00:00')`
 * is interpreted in the *server's* local time, so the same payload would land
 * inside the tournament window on one host and outside it on another. A
 * timestamp without a zone is ambiguous, and an ambiguous `settledAt` decides
 * whether a player scores.
 *
 * Ranges are in the pattern rather than left to `Date.parse`, which is more
 * forgiving than it looks: `Date.parse('2026-11-31T00:00:00Z')` does not fail,
 * it rolls over to 1 December. A producer's off-by-one in the day would
 * silently become a different scoring decision.
 */
export const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt]([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,9})?([Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** Last day of the given 1-based month. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whether the value is an ISO-8601 instant carrying an explicit zone. */
export function isIsoTimestamp(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;

  const match = ISO_TIMESTAMP_PATTERN.exec(raw);
  if (match === null) return false;

  const [, year = '', month = '', day = ''] = match;
  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12) return false;

  const dayNumber = Number(day);
  if (dayNumber < 1 || dayNumber > daysInMonth(Number(year), monthNumber)) return false;

  return !Number.isNaN(Date.parse(raw));
}

/**
 * Parses a validated timestamp.
 *
 * @throws PoisonMessageError with reason `invalid_schema` when the value is
 *         not an instant with a zone, or is not a real calendar date.
 */
export function parseTimestamp(_field: string, _raw: string): Date {
  return notImplemented('parseTimestamp');
}
