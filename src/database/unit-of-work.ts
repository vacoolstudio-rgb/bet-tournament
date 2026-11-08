import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { TransactionScope, UnitOfWorkPort } from './contracts/index.js';

@Injectable()
export class TypeOrmUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Default isolation (read committed) is deliberate. The two races that
   * matter are settled by locks rather than by snapshots: a conflicting insert
   * waits on the unique index and then sees the committed row, and a second
   * rollback waits on the row lock and then re-evaluates its `WHERE status =
   * 'settled'` against the new value. Repeatable read would turn both into
   * serialisation failures to retry, buying nothing.
   */
  withTransaction<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) => work({ manager }));
  }
}
