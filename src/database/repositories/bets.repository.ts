import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { notImplemented } from '../../common/not-implemented.error.js';
import type {
  BetIdentity,
  BetsRepositoryPort,
  InsertSettledBetInput,
  InsertSettledResult,
  InsertTombstoneInput,
  MarkRolledBackInput,
  PlayerBetsQuery,
  VoidedBet,
} from '../contracts/index.js';
import type { Bet } from '../entities/index.js';

/** Postgres adapter for {@link BetsRepositoryPort}. */
@Injectable()
export class BetsRepository implements BetsRepositoryPort {
  constructor(private readonly dataSource: DataSource) {}

  insertSettled(_input: InsertSettledBetInput): Promise<InsertSettledResult> {
    return notImplemented('BetsRepository.insertSettled', this.dataSource);
  }

  markRolledBack(_input: MarkRolledBackInput): Promise<VoidedBet | null> {
    return notImplemented('BetsRepository.markRolledBack', this.dataSource);
  }

  insertTombstone(_input: InsertTombstoneInput): Promise<boolean> {
    return notImplemented('BetsRepository.insertTombstone', this.dataSource);
  }

  latestScoringSettledAt(_input: PlayerBetsQuery): Promise<Date | null> {
    return notImplemented('BetsRepository.latestScoringSettledAt', this.dataSource);
  }

  findOne(_input: BetIdentity): Promise<Bet | null> {
    return notImplemented('BetsRepository.findOne', this.dataSource);
  }
}
