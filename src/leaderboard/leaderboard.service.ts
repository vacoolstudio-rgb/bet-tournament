import { Injectable } from '@nestjs/common';
import { NotImplementedError } from '../common/not-implemented.error.js';
import type { LeaderboardResponseDto } from './dto/index.js';

export const DEFAULT_LEADERBOARD_LIMIT = 100;

@Injectable()
export class LeaderboardService {
  /**
   * The top of the board plus, optionally, where one player stands.
   *
   * Two queries, not one window function over the whole table: the top is an
   * indexed `LIMIT`, and a single player's position is a count of the players
   * sorting above them. Numbering every row to answer both would scale with
   * the number of players rather than with the size of the answer.
   */
  getLeaderboard(_limit: number, _playerId?: string): Promise<LeaderboardResponseDto> {
    throw new NotImplementedError('LeaderboardService.getLeaderboard');
  }
}
