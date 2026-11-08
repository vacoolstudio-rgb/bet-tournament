import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { FxService } from './fx.service.js';
import { FX_SERVICE, SCORING_SERVICE, TOURNAMENT_SERVICE } from './scoring.contract.js';
import { ScoringService } from './scoring.service.js';
import { TournamentService } from './tournament.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: FX_SERVICE, useClass: FxService },
    { provide: TOURNAMENT_SERVICE, useClass: TournamentService },
    { provide: SCORING_SERVICE, useClass: ScoringService },
  ],
  exports: [FX_SERVICE, TOURNAMENT_SERVICE, SCORING_SERVICE],
})
export class ScoringModule {}
