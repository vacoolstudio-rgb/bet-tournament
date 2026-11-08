import { Inject, Injectable } from '@nestjs/common';
import { notImplemented } from '../common/not-implemented.error.js';
import { PLAYER_SCORES_REPOSITORY } from '../database/contracts/index.js';
import type { PlayerScoresRepositoryPort } from '../database/contracts/index.js';
import { TOURNAMENT_SERVICE } from '../scoring/scoring.contract.js';
import type { TournamentPort } from '../scoring/scoring.contract.js';
import type { LeaderboardPort, LeaderboardQuery, LeaderboardView } from './leaderboard.contract.js';

@Injectable()
export class LeaderboardService implements LeaderboardPort {
  constructor(
    @Inject(PLAYER_SCORES_REPOSITORY) private readonly scores: PlayerScoresRepositoryPort,
    @Inject(TOURNAMENT_SERVICE) private readonly tournament: TournamentPort,
  ) {}

  /**
   * The top of the board plus, optionally, where one player stands.
   *
   * Two queries, not one window function over the whole table: the top is an
   * indexed `LIMIT`, and a single player's position is a count of the players
   * sorting above them. Numbering every row to answer both would scale with
   * the number of players rather than with the size of the answer.
   */
  get(_query: LeaderboardQuery): Promise<LeaderboardView> {
    return notImplemented('LeaderboardService.get', this.scores, this.tournament);
  }
}
