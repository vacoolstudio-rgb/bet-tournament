import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { LeaderboardQueryDto, LeaderboardResponseDto } from './dto/index.js';
import { DEFAULT_LEADERBOARD_LIMIT, LEADERBOARD_SERVICE } from './leaderboard.contract.js';
import type { LeaderboardPort, LeaderboardView } from './leaderboard.contract.js';
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
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      '`limit` outside 1..100, or an `X-Player-Id` that is not a valid player id. A ' +
      'malformed id is rejected rather than ignored: answering "you have no points" to a ' +
      'player who has some would be worse than an error.',
  })
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
