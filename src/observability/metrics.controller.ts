import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Response } from 'express';
import { notImplemented } from '../common/not-implemented.error.js';
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
   * Takes the response object because the content type has to come from the
   * registry rather than a literal — Prometheus refuses a body whose declared
   * version it does not recognise, and Express would otherwise label a
   * returned string as `text/html`. `passthrough` keeps the handler returning
   * a value instead of writing the response by hand.
   */
  @Get()
  @ApiExcludeEndpoint()
  @Header('Cache-Control', 'no-store')
  scrape(@Res({ passthrough: true }) _response: Response): Promise<string> {
    return notImplemented('MetricsController.scrape', this.metrics);
  }
}
