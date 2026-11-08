import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { notImplemented } from '../../common/not-implemented.error.js';
import type {
  CreditPointsInput,
  DebitPointsInput,
  DecrementCountedInput,
  PlayerKey,
  PlayerScoreRow,
  PlayerScoresRepositoryPort,
  RankQuery,
  TopQuery,
} from '../contracts/index.js';

/** Postgres adapter for {@link PlayerScoresRepositoryPort}. */
@Injectable()
export class PlayerScoresRepository implements PlayerScoresRepositoryPort {
  constructor(private readonly dataSource: DataSource) {}

  credit(_input: CreditPointsInput): Promise<void> {
    return notImplemented('PlayerScoresRepository.credit', this.dataSource);
  }

  debit(_input: DebitPointsInput): Promise<void> {
    return notImplemented('PlayerScoresRepository.debit', this.dataSource);
  }

  decrementCounted(_input: DecrementCountedInput): Promise<void> {
    return notImplemented('PlayerScoresRepository.decrementCounted', this.dataSource);
  }

  top(_query: TopQuery): Promise<PlayerScoreRow[]> {
    return notImplemented('PlayerScoresRepository.top', this.dataSource);
  }

  findOne(_key: PlayerKey): Promise<PlayerScoreRow | null> {
    return notImplemented('PlayerScoresRepository.findOne', this.dataSource);
  }

  rankOf(_query: RankQuery): Promise<number> {
    return notImplemented('PlayerScoresRepository.rankOf', this.dataSource);
  }
}
