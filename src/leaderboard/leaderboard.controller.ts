import { Controller, Get, Query } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LeaderboardQueryDto, LeaderboardResponseDto } from './dto/index.js';
import { DEFAULT_LEADERBOARD_LIMIT, LeaderboardService } from './leaderboard.service.js';
import { PlayerId } from './player-id.decorator.js';
import { PlayerIdPipe } from './player-id.pipe.js';

@ApiTags('leaderboard')
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  @Get()
  @ApiOperation({
    summary: 'Top of the tournament, and the caller’s position',
    description:
      'Ordered by exact points descending, then by who reached the score first, then by ' +
      'player id, so positions are unique and stable.',
  })
  @ApiHeader({
    name: 'X-Player-Id',
    required: false,
    description: 'Player UUID. When present, the response carries a `me` block.',
  })
  @ApiOkResponse({ type: LeaderboardResponseDto })
  getLeaderboard(
    @Query() query: LeaderboardQueryDto,
    @PlayerId(PlayerIdPipe) playerId: string | undefined,
  ): Promise<LeaderboardResponseDto> {
    return this.leaderboard.getLeaderboard(query.limit ?? DEFAULT_LEADERBOARD_LIMIT, playerId);
  }
}
