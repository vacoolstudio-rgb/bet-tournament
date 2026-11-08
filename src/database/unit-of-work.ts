import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { notImplemented } from '../common/not-implemented.error.js';
import type { TransactionScope, UnitOfWorkPort } from './contracts/index.js';

@Injectable()
export class TypeOrmUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly dataSource: DataSource) {}

  withTransaction<T>(_work: (scope: TransactionScope) => Promise<T>): Promise<T> {
    return notImplemented('TypeOrmUnitOfWork.withTransaction', this.dataSource);
  }
}
