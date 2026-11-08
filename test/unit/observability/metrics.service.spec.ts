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
});
