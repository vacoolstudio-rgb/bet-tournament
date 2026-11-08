import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEFAULT_LEADERBOARD_LIMIT, MAX_LEADERBOARD_LIMIT } from '../leaderboard.contract.js';
import type { LeaderboardQuery } from '../leaderboard.contract.js';

/**
 * The wire form of {@link LeaderboardQuery}, which is why it is a `Partial` of
 * it rather than the thing itself: `limit` is optional here and resolved in the
 * controller, so the query the service receives always has one. The tie exists
 * so a change to the contract's type cannot leave this validating the old one —
 * the other seven DTOs in the project `implement` their contracts, and this was
 * the one shape nothing held.
 */
export class LeaderboardQueryDto implements Partial<Pick<LeaderboardQuery, 'limit'>> {
  /**
   * How many rows to return. The task asks for a top-100, so that is both the
   * default and the ceiling — an unbounded `limit` on a ranked query is a
   * free table scan for anyone who asks.
   */
  //
  // `@ApiPropertyOptional` is what puts this in the OpenAPI document at all.
  // Swagger builds query parameters from its own metadata, not from the
  // validators, so without it the endpoint documented no parameters and a
  // reader of /api/docs had no way to learn that `limit` exists.
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_LEADERBOARD_LIMIT,
    default: DEFAULT_LEADERBOARD_LIMIT,
    description:
      'How many rows to return. The task asks for a top-100, so that is both the default ' +
      'and the ceiling — an unbounded limit on a ranked query is a free table scan for ' +
      'anyone who asks.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LEADERBOARD_LIMIT)
  limit?: number;
}
