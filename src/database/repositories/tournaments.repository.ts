import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { notImplemented } from '../../common/not-implemented.error.js';
import type {
  TournamentCodeQuery,
  TournamentRecord,
  TournamentsRepositoryPort,
  TournamentWindow,
} from '../contracts/index.js';

/** Postgres adapter for {@link TournamentsRepositoryPort}. */
@Injectable()
export class TournamentsRepository implements TournamentsRepositoryPort {
  constructor(private readonly dataSource: DataSource) {}

  upsertByCode(_window: TournamentWindow): Promise<TournamentRecord> {
    return notImplemented('TournamentsRepository.upsertByCode', this.dataSource);
  }

  findByCode(_query: TournamentCodeQuery): Promise<TournamentRecord | null> {
    return notImplemented('TournamentsRepository.findByCode', this.dataSource);
  }
}
