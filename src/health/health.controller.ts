import { Controller, Get } from '@nestjs/common';
import { HealthCheck } from '@nestjs/terminus';
import type { HealthCheckResult } from '@nestjs/terminus';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { NotImplementedError } from '../common/not-implemented.error.js';

@ApiTags('ops')
@Controller('health')
export class HealthController {
  /**
   * Readiness, not liveness: the service is only useful when it can both read
   * the database and reach the broker, so both are checked and a failure is a
   * 503 rather than a cheerful 200 with an empty leaderboard.
   */
  @Get()
  @HealthCheck()
  @ApiOkResponse({ description: 'Database and broker both reachable.' })
  @ApiServiceUnavailableResponse({
    description:
      'At least one dependency is down. The body names which, in Terminus’ ' +
      '`{ status, info, error, details }` shape.',
  })
  check(): Promise<HealthCheckResult> {
    throw new NotImplementedError('HealthController.check');
  }
}
