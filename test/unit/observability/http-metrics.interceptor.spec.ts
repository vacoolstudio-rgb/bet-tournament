import { lastValueFrom, of, throwError } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { HttpMetricsInterceptor } from '../../../src/observability/http-metrics.interceptor.js';
import type {
  HttpRequestOutcome,
  MetricsPort,
} from '../../../src/observability/metrics.contract.js';

/** Collects what the interceptor would have recorded. */
function recorder(): { readonly seen: HttpRequestOutcome[]; readonly port: MetricsPort } {
  const seen: HttpRequestOutcome[] = [];

  return {
    seen,
    port: {
      recordAck: () => undefined,
      recordRetry: () => undefined,
      recordPark: () => undefined,
      observeProcessing: () => undefined,
      observeHttpRequest: (outcome) => void seen.push(outcome),
      render: () => Promise.resolve({ contentType: '', body: '' }),
    },
  };
}

function httpContext(request: unknown, statusCode: number): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ statusCode }),
    }),
  } as unknown as ExecutionContext;
}

const handlerOf = (source: CallHandler['handle']): CallHandler => ({ handle: source });

describe('HttpMetricsInterceptor', () => {
  it('labels a successful request with its route pattern and status', async () => {
    const { seen, port } = recorder();
    const interceptor = new HttpMetricsInterceptor(port);

    await lastValueFrom(
      interceptor.intercept(
        httpContext({ method: 'GET', route: { path: '/leaderboard' } }, 200),
        handlerOf(() => of('ok')),
      ),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'GET', route: '/leaderboard', status: 200 });
    expect(seen[0]?.seconds).toBeGreaterThanOrEqual(0);
  });

  it('records a thrown request with the status of the error', async () => {
    // The exception filter has not run yet, so the response still says 200 —
    // recording that would hide every 4xx the API returns.
    const { seen, port } = recorder();
    const interceptor = new HttpMetricsInterceptor(port);

    await expect(
      lastValueFrom(
        interceptor.intercept(
          httpContext({ method: 'GET', route: { path: '/leaderboard' } }, 200),
          handlerOf(() => throwError(() => Object.assign(new Error('bad'), { status: 400 }))),
        ),
      ),
    ).rejects.toThrow('bad');

    expect(seen[0]).toMatchObject({ status: 400 });
  });

  it('treats an error without a usable status as a server error', async () => {
    const { seen, port } = recorder();
    const interceptor = new HttpMetricsInterceptor(port);

    await expect(
      lastValueFrom(
        interceptor.intercept(
          httpContext({ method: 'GET', route: { path: '/leaderboard' } }, 200),
          handlerOf(() => throwError(() => new Error('boom'))),
        ),
      ),
    ).rejects.toThrow('boom');

    expect(seen[0]).toMatchObject({ status: 500 });
  });

  it('never labels a request with its URL', async () => {
    // An unmatched path is attacker-controlled: labelling it would let anyone
    // mint time series until the scrape falls over.
    const { seen, port } = recorder();
    const interceptor = new HttpMetricsInterceptor(port);

    await lastValueFrom(
      interceptor.intercept(
        httpContext({ method: 'GET', url: '/nope/' + 'x'.repeat(50), route: undefined }, 404),
        handlerOf(() => of('nope')),
      ),
    );

    expect(seen[0]?.route).toBe('unmatched');
  });

  it('ignores anything that is not an HTTP call', async () => {
    const { seen, port } = recorder();
    const interceptor = new HttpMetricsInterceptor(port);
    const context = { getType: () => 'rpc' } as unknown as ExecutionContext;

    await lastValueFrom(
      interceptor.intercept(
        context,
        handlerOf(() => of('ok')),
      ),
    );

    expect(seen).toHaveLength(0);
  });
});
