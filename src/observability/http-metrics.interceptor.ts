import { Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { METRICS } from './metrics.contract.js';
import type { MetricsPort } from './metrics.contract.js';

/** What a thrown request carries when it knows its own status. */
interface StatusCarrier {
  readonly status?: unknown;
}

/**
 * Records every finished HTTP request.
 *
 * An interceptor rather than middleware, because middleware runs before
 * routing and would have no route pattern to label with — only the URL, which
 * is a different time series per query string.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(@Inject(METRICS) private readonly metrics: MetricsPort) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = performance.now();

    return next.handle().pipe(
      tap({
        next: () => this.record(request, response.statusCode, startedAt),
        // A thrown request still finished, and it is the one worth graphing.
        // The exception filter has not run yet, so the response still says 200
        // and the status has to come from the error itself.
        error: (error: unknown) => this.record(request, this.statusOf(error), startedAt),
      }),
    );
  }

  private record(request: Request, status: number, startedAt: number): void {
    this.metrics.observeHttpRequest({
      method: request.method,
      route: this.routeOf(request),
      status,
      seconds: (performance.now() - startedAt) / 1000,
    });
  }

  /**
   * The matched route pattern, or one constant when there is none.
   *
   * Never the URL: a path the router does not know is chosen by whoever asked
   * for it, and a label made from it mints time series until the scrape falls
   * over. Express types `route` as `any`, so the shape is checked rather than
   * asserted.
   */
  private routeOf(request: Request): string {
    const route: unknown = request.route;
    if (typeof route !== 'object' || route === null || !('path' in route)) return 'unmatched';

    const { path } = route;

    return typeof path === 'string' ? path : 'unmatched';
  }

  /** An error's own status, or a server error when it claims nothing usable. */
  private statusOf(error: unknown): number {
    if (typeof error !== 'object' || error === null || !('status' in error)) return 500;

    const status = Number((error as StatusCarrier).status);

    return Number.isFinite(status) ? status : 500;
  }
}
