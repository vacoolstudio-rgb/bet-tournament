import { Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { METRICS } from './metrics.contract.js';
import type { MetricsPort } from './metrics.contract.js';

/**
 * Records every finished HTTP request.
 *
 * An interceptor rather than middleware, because middleware runs before
 * routing and would have no route pattern to label with — only the URL, which
 * is a different time series per query string.
 */
/** The matched route pattern, or a single constant when there is none. */
function routeOf(request: Request): string {
  const route: unknown = request.route;
  if (typeof route !== 'object' || route === null || !('path' in route)) return 'unmatched';

  const { path } = route;

  return typeof path === 'string' ? path : 'unmatched';
}

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(@Inject(METRICS) private readonly metrics: MetricsPort) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = performance.now();

    const record = (status: number): void => {
      this.metrics.observeHttpRequest({
        method: request.method,
        // The pattern, falling back to a constant rather than to the URL: an
        // unmatched request must not mint a new label value. Express types
        // `route` as `any`, so the shape is checked rather than asserted.
        route: routeOf(request),
        status,
        seconds: (performance.now() - startedAt) / 1000,
      });
    };

    return next.handle().pipe(
      tap({
        next: () => record(response.statusCode),
        // A thrown request still finished, and it is the one worth graphing.
        // The exception filter has not run yet, so the status comes from the
        // error itself.
        error: (error: unknown) => {
          const status =
            typeof error === 'object' && error !== null && 'status' in error
              ? Number(error.status)
              : 500;
          record(Number.isFinite(status) ? status : 500);
        },
      }),
    );
  }
}
