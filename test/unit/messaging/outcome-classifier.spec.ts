import {
  AmountOutOfRangeError,
  PoisonMessageError,
  RetryableError,
  UnknownCurrencyError,
} from '../../../src/common/errors.js';
import { OutcomeClassifier } from '../../../src/messaging/outcome.classifier.js';
import { fakeConfig } from '../../support/fakes.js';

const classifier = new OutcomeClassifier(fakeConfig());

describe('OutcomeClassifier', () => {
  it.each([
    ['a schema failure', new PoisonMessageError('invalid_schema', 'bad payload'), 'invalid_schema'],
    ['an unconfigured currency', new UnknownCurrencyError('XYZ'), 'unknown_currency'],
    [
      'an amount out of range',
      new AmountOutOfRangeError('winAmount', '1e20', 'is too large'),
      'amount_out_of_range',
    ],
  ])('parks %s on the first attempt', (_case, error, reason) => {
    const outcome = classifier.classify({ error, attempt: 1 });

    expect(outcome.kind).toBe('park');
    expect(outcome.kind === 'park' && outcome.reason).toBe(reason);
  });

  it('retries an infrastructure failure', () => {
    const outcome = classifier.classify({ error: new RetryableError('db is down'), attempt: 1 });

    expect(outcome).toMatchObject({ kind: 'retry', attempt: 1 });
  });

  it('retries an error it has never seen before', () => {
    // An unrecognised failure is assumed transient: retrying something
    // permanent costs four more deliveries, parking something transient loses
    // a settled bet.
    expect(classifier.classify({ error: new Error('ECONNRESET'), attempt: 2 }).kind).toBe('retry');
  });

  it('retries up to the configured limit', () => {
    const outcome = classifier.classify({ error: new RetryableError('timeout'), attempt: 4 });

    expect(outcome).toMatchObject({ kind: 'retry', attempt: 4 });
  });

  it('parks once the attempts are exhausted', () => {
    const outcome = classifier.classify({ error: new RetryableError('timeout'), attempt: 5 });

    expect(outcome).toMatchObject({ kind: 'park', reason: 'attempts_exhausted', attempts: 5 });
  });

  it('parks beyond the limit too, in case a delivery slipped past', () => {
    expect(classifier.classify({ error: new RetryableError('timeout'), attempt: 9 }).kind).toBe(
      'park',
    );
  });

  it('honours a different limit from config', () => {
    const strict = new OutcomeClassifier(
      fakeConfig({
        rabbit: { url: 'amqp://localhost', prefetch: 1, maxAttempts: 2, retryTtlMs: 1000 },
      }),
    );

    expect(strict.classify({ error: new RetryableError('x'), attempt: 2 }).kind).toBe('park');
  });

  it('wraps a thrown non-error so the outcome always carries an Error', () => {
    // `throw 'oops'` happens, and the parking headers interpolate
    // error.name/error.message.
    const outcome = classifier.classify({ error: 'oops', attempt: 1 });

    expect(outcome.error).toBeInstanceOf(Error);
    expect(outcome.error.message).toContain('oops');
  });

  it('parks a poison error even when the attempts are exhausted, with its own reason', () => {
    // The reason a human needs is "the payload is broken", not "we gave up".
    const outcome = classifier.classify({
      error: new PoisonMessageError('unknown_routing_key', 'bet.weird'),
      attempt: 9,
    });

    expect(outcome.kind === 'park' && outcome.reason).toBe('unknown_routing_key');
  });
});
