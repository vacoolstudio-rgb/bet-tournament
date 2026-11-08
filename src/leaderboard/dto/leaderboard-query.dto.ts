import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_LEADERBOARD_LIMIT } from '../leaderboard.contract.js';

export class LeaderboardQueryDto {
  /**
   * How many rows to return. The task asks for a top-100, so that is both the
   * default and the ceiling — an unbounded `limit` on a ranked query is a
   * free table scan for anyone who asks.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LEADERBOARD_LIMIT)
  limit?: number;
}
