import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

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
  @Max(100)
  limit?: number;
}
