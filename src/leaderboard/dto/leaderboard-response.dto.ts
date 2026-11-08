import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LeaderboardEntryDto {
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

export class TournamentInfoDto {
  @ApiProperty({ example: 'nov-2026' })
  code: string;

  @ApiProperty({ description: 'Inclusive' })
  startsAt: string;

  @ApiProperty({ description: 'Exclusive' })
  endsAt: string;

  @ApiProperty({ enum: ['pending', 'active', 'finished'] })
  status: 'pending' | 'active' | 'finished';
}

export class LeaderboardResponseDto {
  @ApiProperty({ type: TournamentInfoDto })
  tournament: TournamentInfoDto;

  @ApiProperty({ type: [LeaderboardEntryDto] })
  top: LeaderboardEntryDto[];

  @ApiPropertyOptional({
    type: LeaderboardEntryDto,
    nullable: true,
    description:
      'The caller from `X-Player-Id`. Null when the header is absent. A player with no ' +
      'scoring bets yet gets `points: 0` and `rank: null` — the service does not know how ' +
      'many players the tournament has, so it cannot invent a last place.',
  })
  me: (Omit<LeaderboardEntryDto, 'rank'> & { rank: number | null }) | null;

  @ApiProperty({ format: 'date-time' })
  generatedAt: string;
}
