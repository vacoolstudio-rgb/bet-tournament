import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { LeaderboardModule } from './leaderboard/leaderboard.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { LoggingModule } from './observability/logging.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { ScoringModule } from './scoring/scoring.module.js';

/**
 * Composition root. The API and the consumer live in one process: they share
 * the same database connection pool and the same scoring code, and splitting
 * them would be two deployables to prove one point.
 */
@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    ObservabilityModule,
    DatabaseModule,
    ScoringModule,
    MessagingModule,
    LeaderboardModule,
    HealthModule,
  ],
})
export class AppModule {}
