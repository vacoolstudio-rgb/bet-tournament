import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ScoringModule } from '../scoring/scoring.module.js';
import { LeaderboardController } from './leaderboard.controller.js';
import { LeaderboardService } from './leaderboard.service.js';
import { PlayerIdPipe } from './player-id.pipe.js';

@Module({
  imports: [DatabaseModule, ScoringModule],
  controllers: [LeaderboardController],
  providers: [LeaderboardService, PlayerIdPipe],
})
export class LeaderboardModule {}
