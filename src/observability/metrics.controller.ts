import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { METRICS } from './metrics.contract.js';
import type { MetricsPort } from './metrics.contract.js';

@Controller('metrics')
export class MetricsController {
  constructor(@Inject(METRICS) private readonly metrics: MetricsPort) {}

  /**
   * Prometheus scrape endpoint. Excluded from Swagger: its consumer is a
   * scraper that already knows the format, and the exposition text would only
   * clutter the API docs.
   *
   * The content type is set from the registry's own value rather than
   * hardcoded — Prometheus rejects a response whose version it does not
   * recognise.
   */
  @Get()
  @ApiExcludeEndpoint()
  @Header('Cache-Control', 'no-store')
  async scrape(): Promise<string> {
    const snapshot = await this.metrics.render();

    return snapshot.body;
  }
}
