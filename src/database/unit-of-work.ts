import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { TransactionScope, UnitOfWorkPort } from './contracts/index.js';

@Injectable()
export class TypeOrmUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Read committed, asked for rather than inherited.
   *
   * The two races that matter are settled by locks rather than by snapshots: a
   * conflicting insert waits on the unique index and then sees the committed
   * row, and a rollback that lost the race waits, then re-evaluates its
   * `WHERE status = 'settled'` against the new value and debits. That second
   * one is how a rollback arriving alongside its settle takes the points off
   * at all.
   *
   * Under repeatable read it does not work: the insert raises
   * `could not serialize access due to concurrent update` instead of
   * conflicting, the transaction aborts, and the bet is left `settled` —
   * measured, both levels, with these exact statements. The service still
   * converges, because that error is retryable and the work is idempotent, but
   * it pays a delivery for it, and the attempt budget is finite.
   *
   * `default_transaction_isolation` is a database and role setting, so taking
   * the default would make a domain invariant depend on how the server happens
   * to be configured. One argument removes the dependency.
   */
  withTransaction<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T> {
    return this.dataSource.transaction('READ COMMITTED', (manager) => work({ manager }));
  }
}
