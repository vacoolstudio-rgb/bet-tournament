/**
 * The wire contract, exactly as the task specifies it.
 *
 * Amounts are `string | number` because the task does not say which, and a
 * consumer that insists on one shape rejects a producer that sends the other.
 * The DTO classes validate these shapes; this interface is what the producer,
 * the tests and the documentation agree on.
 */
export interface BetSettledEvent {
  readonly betId: string;
  readonly playerId: string;
  /** 3-letter code; must have a rate in `FX_RATES` (USD is implicit). */
  readonly currency: string;
  /** Kept for audit; takes no part in scoring. */
  readonly stake: string | number;
  /** Converted to USD, this is the score. */
  readonly winAmount: string | number;
  /** ISO-8601. Decides whether the bet falls inside the tournament window. */
  readonly settledAt: string;
}

/**
 * `bet.rollback` carries the same envelope, but only the identity is required
 * and only the identity is used.
 *
 * This is not laziness about optional fields — it is the contract enforcing a
 * correctness rule. Reading `currency` here would park a legitimate rollback
 * whose currency had been dropped from the config; reading `settledAt` here
 * would ignore a rollback for a bet settled outside the window. Both leave the
 * points credited forever. How much to subtract is known from the journal.
 */
export interface BetRollbackEvent {
  readonly betId: string;
  /** Used for logs, and for the tombstone when the settle has not arrived. */
  readonly playerId: string;
  readonly currency?: string | undefined;
  readonly stake?: string | number | undefined;
  readonly winAmount?: string | number | undefined;
  readonly settledAt?: string | undefined;
}

/** Routing keys this service consumes. Anything else is parked. */
export type BetEventName = 'bet.settled' | 'bet.rollback';
