/** What a `bet.settled` event did. */
export type SettleOutcome =
  | { readonly status: 'scored'; readonly pointsAwarded: string }
  /** A losing bet: journalled for idempotency and rollback, worth no points. */
  | { readonly status: 'scored_zero' }
  /** Already journalled — a redelivery. */
  | { readonly status: 'duplicate' }
  /** A rollback got here first; the audit columns were filled, nothing scored. */
  | { readonly status: 'already_rolled_back' }
  /** `settledAt` is outside the tournament window. */
  | { readonly status: 'out_of_window' };

/** What a `bet.rollback` event did. */
export type RollbackOutcome =
  | { readonly status: 'rolled_back'; readonly pointsRemoved: string }
  /** The bet has not been settled yet; a tombstone now blocks its scoring. */
  | { readonly status: 'tombstoned' }
  /** Already void — a redelivery or a second rollback. */
  | { readonly status: 'duplicate' };
