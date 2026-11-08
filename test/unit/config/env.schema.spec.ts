import { loadConfig } from '../../../src/config/app-config.js';

/** The minimum a valid environment has to carry. */
function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgresql://tournament:tournament@localhost:5432/tournament',
    RABBITMQ_URL: 'amqp://tournament:tournament@localhost:5672',
    FX_RATES: '{"EUR":1.08,"GBP":"1.27"}',
    TOURNAMENT_CODE: 'nov-2026',
    TOURNAMENT_STARTS_AT: '2026-11-01T00:00:00.000Z',
    TOURNAMENT_ENDS_AT: '2026-12-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    const config = loadConfig(env());

    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.log).toEqual({ level: 'info', pretty: false });
    expect(config.rabbit.prefetch).toBe(20);
    expect(config.rabbit.maxAttempts).toBe(5);
    expect(config.rabbit.retryTtlMs).toBe(10_000);
  });

  it('shapes the result by concern rather than by variable name', () => {
    const config = loadConfig(env({ PORT: '4000', RABBITMQ_PREFETCH: '50' }));

    expect(config.port).toBe(4000);
    expect(config.rabbit.prefetch).toBe(50);
    expect(config.tournament.code).toBe('nov-2026');
    expect(config.tournament.startsAt.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('keeps FX rates as strings, whichever shape they arrived in', () => {
    // A JSON number is a float and these get multiplied by money; the string
    // round-trips exactly, so both inputs end up as the same text.
    const config = loadConfig(env({ FX_RATES: '{"EUR":1.08,"GBP":"1.27"}' }));

    expect(config.fxRates).toEqual({ EUR: '1.08', GBP: '1.27' });
  });

  it('freezes the rate table so nothing can edit it at runtime', () => {
    const config = loadConfig(env());

    expect(Object.isFrozen(config.fxRates)).toBe(true);
  });

  describe('rejects', () => {
    it.each([
      ['a missing DATABASE_URL', { DATABASE_URL: undefined }],
      ['a DATABASE_URL with the wrong scheme', { DATABASE_URL: 'mysql://localhost:3306/db' }],
      ['a RABBITMQ_URL with the wrong scheme', { RABBITMQ_URL: 'http://localhost:5672' }],
      ['a missing FX_RATES', { FX_RATES: undefined }],
      ['FX_RATES that is not JSON', { FX_RATES: 'EUR=1.08' }],
      ['FX_RATES that is not an object', { FX_RATES: '"EUR"' }],
      // The union used to let any string past unchecked, so "abc" and "-1"
      // were accepted as rates and a negative rate subtracts points for
      // winning.
      ['a non-numeric rate', { FX_RATES: '{"EUR":"abc"}' }],
      ['a negative rate', { FX_RATES: '{"EUR":"-1.08"}' }],
      ['a zero rate', { FX_RATES: '{"EUR":0}' }],
      ['a rate above the bound', { FX_RATES: '{"EUR":"10000000"}' }],
      ['a currency code that is too short', { FX_RATES: '{"EU":1.08}' }],
      ['a lowercase currency code', { FX_RATES: '{"eur":1.08}' }],
      // Its rate is 1 by definition, and a configurable 1 is a configurable
      // way to get it wrong.
      ['USD among the rates', { FX_RATES: '{"USD":1,"EUR":1.08}' }],
      ['a missing tournament code', { TOURNAMENT_CODE: undefined }],
      ['a window that ends before it starts', { TOURNAMENT_ENDS_AT: '2026-10-01T00:00:00.000Z' }],
      ['a window that ends when it starts', { TOURNAMENT_ENDS_AT: '2026-11-01T00:00:00.000Z' }],
      ['an unparseable start', { TOURNAMENT_STARTS_AT: 'soon' }],
      ['a port of zero', { PORT: '0' }],
      ['a port above the range', { PORT: '70000' }],
      ['a non-numeric port', { PORT: 'http' }],
      ['an unknown log level', { LOG_LEVEL: 'chatty' }],
      ['a non-boolean LOG_PRETTY', { LOG_PRETTY: 'yes' }],
      ['a prefetch of zero', { RABBITMQ_PREFETCH: '0' }],
      ['zero attempts', { RABBITMQ_MAX_ATTEMPTS: '0' }],
      ['a negative retry delay', { RABBITMQ_RETRY_TTL_MS: '-1' }],
      ['an unknown NODE_ENV', { NODE_ENV: 'staging' }],
    ])('%s', (_case, overrides) => {
      expect(() => loadConfig(env(overrides))).toThrow();
    });
  });

  it('accepts a crypto ticker as a currency', () => {
    const config = loadConfig(env({ FX_RATES: '{"USDT":"0.9998","MATIC":"0.41"}' }));

    expect(config.fxRates).toEqual({ USDT: '0.9998', MATIC: '0.41' });
  });

  it('names every offending variable at once, not just the first', () => {
    // One failed boot per misconfiguration, not one per variable.
    try {
      loadConfig(env({ PORT: '0', LOG_LEVEL: 'chatty' }));
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = JSON.stringify(error);

      expect(message).toContain('PORT');
      expect(message).toContain('LOG_LEVEL');
    }
  });
});
