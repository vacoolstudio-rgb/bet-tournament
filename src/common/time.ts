import { notImplemented } from './not-implemented.error.js';

/**
 * ISO-8601 instant with an explicit zone — `Z` or `±hh:mm`.
 *
 * The zone is mandatory, and that is not pedantry. `new Date('2026-11-08T10:00:00')`
 * is interpreted in the *server's* local time, so the same payload would land
 * inside the tournament window on one host and outside it on another. A
 * timestamp without a zone is ambiguous, and an ambiguous `settledAt` decides
 * whether a player scores.
 */
export const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d{1,9})?([Zz]|[+-]\d{2}:\d{2})$/;

/** Whether the value is an ISO-8601 instant carrying an explicit zone. */
export function isIsoTimestamp(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  if (!ISO_TIMESTAMP_PATTERN.test(raw)) return false;

  return !Number.isNaN(Date.parse(raw));
}

/**
 * Parses a validated timestamp.
 *
 * @throws PoisonMessageError with reason `invalid_schema` when the value is
 *         not an instant with a zone.
 */
export function parseTimestamp(_field: string, _raw: string): Date {
  return notImplemented('parseTimestamp');
}
