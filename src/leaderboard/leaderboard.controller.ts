import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LeaderboardQueryDto, LeaderboardResponseDto } from './dto/index.js';
import { LEADERBOARD_SERVICE } from './leaderboard.contract.js';
import type { LeaderboardPort, LeaderboardView } from './leaderboard.contract.js';
import { DEFAULT_LEADERBOARD_LIMIT } from './leaderboard.service.js';
import { PlayerId } from './player-id.decorator.js';
import { PlayerIdPipe } from './player-id.pipe.js';

@ApiTags('leaderboard')
@Controller('leaderboard')
export class LeaderboardController {
  constructor(@Inject(LEADERBOARD_SERVICE) private readonly leaderboard: LeaderboardPort) {}

  /**
   * Returns the view as the contract defines it. `LeaderboardResponseDto` is
   * the same shape for Swagger's benefit, so there is nothing to map and
   * nothing to keep in sync by hand.
   */
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
  ): Promise<LeaderboardView> {
    return this.leaderboard.get({
      limit: query.limit ?? DEFAULT_LEADERBOARD_LIMIT,
      playerId,
    });
  }
}
