import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import type { HealthCheckResult, HealthIndicatorResult } from '@nestjs/terminus';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { BROKER_HEALTH } from '../messaging/contracts/index.js';
import type { BrokerHealthPort } from '../messaging/contracts/index.js';

@ApiTags('ops')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: TypeOrmHealthIndicator,
    private readonly indicators: HealthIndicatorService,
    @Inject(BROKER_HEALTH) private readonly broker: BrokerHealthPort,
  ) {}

  /**
   * Readiness, not liveness: the service is only useful when it can both read
   * the database and reach the broker, so both are checked and a failure is a
   * 503 rather than a cheerful 200 over an empty leaderboard.
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
    return this.health.check([
      () => this.database.pingCheck('database', { timeout: 2_000 }),
      () => this.brokerCheck(),
    ]);
  }

  private brokerCheck(): HealthIndicatorResult {
    const indicator = this.indicators.check('broker');

    return this.broker.isConnected()
      ? indicator.up()
      : indicator.down({ message: 'AMQP connection is not established' });
  }
}
