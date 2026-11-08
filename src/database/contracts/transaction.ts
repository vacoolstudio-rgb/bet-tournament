import type { EntityManager } from 'typeorm';

/**
 * A handle on an open transaction, passed from the service that opened it to
 * the repositories that write inside it.
 *
 * Not branded or made opaque: hiding `manager` behind a symbol would buy
 * nothing here, since the only caller that could misuse it is the one that
 * also owns the transaction. What it does buy is a single named type instead
 * of an `EntityManager` parameter threaded through every signature — the
 * services never touch the field.
 */
export interface TransactionScope {
  readonly manager: EntityManager;
}

export interface UnitOfWorkPort {
  /**
   * Runs `work` in one transaction, committing on return and rolling back on
   * throw.
   *
   * Scoring needs this because the journal insert and the aggregate update are
   * one fact: a crash between them would either lose points or credit a bet
   * twice on redelivery.
   */
  withTransaction<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T>;
}

export const UNIT_OF_WORK = Symbol('UnitOfWorkPort');
