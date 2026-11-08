import { METRIC_NAMES } from '../../../src/observability/metrics.contract.js';
import { MetricsService } from '../../../src/observability/metrics.service.js';

describe('MetricsService', () => {
  it('renders the Prometheus text format with its own content type', async () => {
    const metrics = new MetricsService();

    const snapshot = await metrics.render();

    // Hardcoding the header is how a scrape starts failing after a library
    // upgrade; it comes from the registry instead.
    expect(snapshot.contentType).toContain('text/plain');
    expect(snapshot.contentType).toContain('version=');
  });

  it('counts acknowledgements by reason', async () => {
    const metrics = new MetricsService();

    metrics.recordAck('scored');
    metrics.recordAck('scored');
    metrics.recordAck('duplicate');

    const { body } = await metrics.render();
    expect(body).toContain(`${METRIC_NAMES.acknowledged}{reason="scored"} 2`);
    expect(body).toContain(`${METRIC_NAMES.acknowledged}{reason="duplicate"} 1`);
  });

  it('counts retries and parkings separately', async () => {
    // An operator needs to tell "we are waiting on the database" apart from
    // "we have given up on these events".
    const metrics = new MetricsService();

    metrics.recordRetry(2);
    metrics.recordPark('unknown_currency');

    const { body } = await metrics.render();
    expect(body).toContain(METRIC_NAMES.retried);
    expect(body).toContain(`${METRIC_NAMES.parked}{reason="unknown_currency"} 1`);
  });

  it('observes processing time as a histogram', async () => {
    const metrics = new MetricsService();

    metrics.observeProcessing(0.012);

    const { body } = await metrics.render();
    expect(body).toContain(`${METRIC_NAMES.processing}_bucket`);
  });

  it('exposes a counter at zero before anything happens', async () => {
    // A metric that only appears after the first event makes an alert on it
    // unwritable: "no data" and "nothing went wrong" look the same.
    const { body } = await new MetricsService().render();

    expect(body).toContain(METRIC_NAMES.acknowledged);
  });

  it('keeps its own registry, so two instances can coexist', async () => {
    // The default global registry throws on a duplicate collector, which turns
    // two test suites in one process into a failure with no connection to
    // either test.
    const first = new MetricsService();
    const second = new MetricsService();

    first.recordAck('scored');
    second.recordAck('duplicate');

    expect((await first.render()).body).not.toContain('duplicate');
  });

  it('labels HTTP requests by method, route pattern and status', async () => {
    const metrics = new MetricsService();

    metrics.observeHttpRequest({
      method: 'GET',
      route: '/leaderboard',
      status: 200,
      seconds: 0.012,
    });
    metrics.observeHttpRequest({
      method: 'GET',
      route: '/leaderboard',
      status: 400,
      seconds: 0.002,
    });

    const { body } = await metrics.render();
    expect(body).toContain(
      `${METRIC_NAMES.httpRequests}{method="GET",route="/leaderboard",status="200"} 1`,
    );
    expect(body).toContain(
      `${METRIC_NAMES.httpRequests}{method="GET",route="/leaderboard",status="400"} 1`,
    );
    // The histogram is what answers "how slow is the board", and a count
    // without a sum cannot produce a latency.
    expect(body).toContain(`${METRIC_NAMES.httpDuration}_sum`);
    expect(body).toContain(`${METRIC_NAMES.httpDuration}_bucket`);
  });

  it('exposes process and event-loop metrics', async () => {
    // Saturation is the half of the picture the service cannot report about
    // itself: a consumer that has stopped keeping up looks healthy in its own
    // counters and obvious in the event-loop lag.
    const metrics = new MetricsService();

    const { body } = await metrics.render();
    expect(body).toContain('nodejs_eventloop_lag_p99_seconds');
    expect(body).toContain('nodejs_heap_size_used_bytes');
    expect(body).toContain('process_resident_memory_bytes');
  });

  it('keeps its metrics out of the library default registry', async () => {
    // Two MetricsService instances exist in the integration tests, and a
    // shared global registry makes the second constructor throw on duplicate
    // registration — and the suite fail for a reason unrelated to the test.
    const first = new MetricsService();
    const second = new MetricsService();

    first.recordAck('scored');

    const { body } = await second.render();
    expect(body).not.toContain(`${METRIC_NAMES.acknowledged}{reason="scored"} 1`);
  });
});
