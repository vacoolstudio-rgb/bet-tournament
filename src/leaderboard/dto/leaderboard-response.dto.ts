import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  LeaderboardEntry,
  LeaderboardView,
  PlayerStanding,
  TournamentInfo,
} from '../leaderboard.contract.js';

/**
 * Swagger projections of the contracts in `leaderboard.contract.ts`.
 *
 * The interfaces are what the code depends on; these classes exist because
 * decorators need a runtime class to hang metadata on. `implements` keeps the
 * two from drifting — a renamed field fails the build rather than quietly
 * documenting a response that no longer exists.
 */
export class LeaderboardEntryDto implements LeaderboardEntry {
  @ApiProperty({ example: 1, description: '1-based position in the tournament' })
  rank: number;

  @ApiProperty({ format: 'uuid' })
  playerId: string;

  @ApiProperty({
    example: 1532,
    description: 'Whole points — "1 point per 1 USD won", truncated towards zero',
  })
  points: number;

  @ApiProperty({
    example: '1532.480000',
    description:
      'Exact points. Ranking uses this, not the truncated value, so two players can ' +
      'show the same `points` and hold different ranks.',
  })
  pointsExact: string;

  @ApiProperty({ example: 41, description: 'Settled bets counted, losing ones included' })
  betsCounted: number;
}

export class PlayerStandingDto implements PlayerStanding {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Null for a player with no scoring bets: the service does not know how many ' +
      'players the tournament has, so it cannot invent a last place.',
  })
  rank: number | null;

  @ApiProperty({ format: 'uuid' })
  playerId: string;

  @ApiProperty({ example: 87 })
  points: number;

  @ApiProperty({ example: '87.120000' })
  pointsExact: string;

  @ApiProperty({ example: 6 })
  betsCounted: number;
}

export class TournamentInfoDto implements TournamentInfo {
  @ApiProperty({ example: 'nov-2026' })
  code: string;

  @ApiProperty({ description: 'Inclusive' })
  startsAt: string;

  @ApiProperty({ description: 'Exclusive' })
  endsAt: string;

  @ApiProperty({ enum: ['pending', 'active', 'finished'] })
  status: 'pending' | 'active' | 'finished';
}

export class LeaderboardResponseDto implements LeaderboardView {
  @ApiProperty({ type: TournamentInfoDto })
  tournament: TournamentInfoDto;

  @ApiProperty({ type: [LeaderboardEntryDto] })
  top: LeaderboardEntryDto[];

  @ApiPropertyOptional({
    type: PlayerStandingDto,
    nullable: true,
    description: 'The caller from `X-Player-Id`. Null when the header is absent.',
  })
  me: PlayerStandingDto | null;

  @ApiProperty({ format: 'date-time' })
  generatedAt: string;
}
