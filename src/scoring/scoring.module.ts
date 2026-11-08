import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { FxService } from './fx.service.js';
import { ScoringService } from './scoring.service.js';
import { TournamentService } from './tournament.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [FxService, ScoringService, TournamentService],
  exports: [FxService, ScoringService, TournamentService],
})
export class ScoringModule {}
