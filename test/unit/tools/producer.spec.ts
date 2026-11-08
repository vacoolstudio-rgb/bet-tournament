import { plainToInstance } from 'class-transformer';
import type { ClassConstructor } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BetRollbackEventDto, BetSettledEventDto } from '../../../src/messaging/dto/index.js';
import { planScenario, scenarios } from '../../../tools/producer.js';
import type { PlannedMessage, ScenarioName } from '../../../tools/producer.js';

/**
 * The producer is a deliverable of its own: the task asks for it so the
 * service can be driven by hand. Planning is kept separate from publishing
 * exactly so it can be checked here, without a broker.
 */
function plan(scenario: ScenarioName, count = 1): readonly PlannedMessage[] {
  return planScenario({ scenario, count });
}

function isValid<T extends object>(dto: ClassConstructor<T>, payload: unknown): boolean {
  return validateSync(plainToInstance(dto, payload), { whitelist: true }).length === 0;
}

/**
 * The fields a planned event can carry, flattened so a test can read the one
 * it is about.
 *
 * Typed rather than `Record<string, unknown>` so that reading a field no
 * scenario sets is a compile error rather than an `undefined` that quietly
 * satisfies the assertion.
 */
interface PlannedPayload {
  readonly betId: string;
  readonly playerId: string;
  readonly currency: string;
  readonly stake: string | number;
  readonly winAmount: string | number;
  readonly settledAt: string;
}

/** Narrows a planned message to its event payload, failing loudly otherwise. */
function payloadOf(message: PlannedMessage | undefined): PlannedPayload {
  if (message === undefined || message.kind === 'raw') {
    throw new Error('expected a typed event, got a raw body or nothing at all');
  }

  return message.payload as PlannedPayload;
}

describe('the scenario catalogue', () => {
  it('says what each scenario proves, because that is what --list prints', () => {
    expect(scenarios.every((scenario) => scenario.proves.length > 10)).toBe(true);
  });

  it('can plan every scenario it advertises', () => {
    for (const scenario of scenarios) {
      expect(plan(scenario.name, 3).length).toBeGreaterThan(0);
    }
  });
});

describe('planned events', () => {
  it('builds payloads the service accepts', () => {
    // A producer whose events its own consumer rejects proves nothing, so
    // every typed message is validated against the real DTO here.
    for (const scenario of scenarios) {
      for (const message of plan(scenario.name, 2)) {
        if (message.kind === 'settled') {
          expect(isValid(BetSettledEventDto, message.payload)).toBe(true);
        }
        if (message.kind === 'rollback') {
          expect(isValid(BetRollbackEventDto, message.payload)).toBe(true);
        }
      }
    }
  });

  it('routes each message by its kind', () => {
    for (const scenario of scenarios) {
      for (const message of plan(scenario.name, 2)) {
        if (message.kind === 'settled') expect(message.routingKey).toBe('bet.settled');
        if (message.kind === 'rollback') expect(message.routingKey).toBe('bet.rollback');
      }
    }
  });
});

describe('the scenarios that make a claim checkable', () => {
  it('duplicate publishes one bet twice, byte for byte', () => {
    const messages = plan('duplicate');

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(messages[1]);
  });

  it('rollback settles a bet and then voids that same bet', () => {
    const [settled, rolled] = plan('rollback');

    expect(settled?.kind).toBe('settled');
    expect(rolled?.kind).toBe('rollback');
    expect(payloadOf(rolled).betId).toBe(payloadOf(settled).betId);
  });

  it('rollback-first puts the rollback ahead of the settle', () => {
    expect(plan('rollback-first').map((message) => message.kind)).toEqual(['rollback', 'settled']);
  });

  it('rollback-twice sends the same rollback twice', () => {
    expect(plan('rollback-twice').map((message) => message.kind)).toEqual([
      'settled',
      'rollback',
      'rollback',
    ]);
  });

  it('losing-bet wins nothing', () => {
    const [message] = plan('losing-bet');

    expect(Number(payloadOf(message).winAmount)).toBe(0);
  });

  it('unknown-currency uses a code no sane config would carry', () => {
    const [message] = plan('unknown-currency');

    expect(['EUR', 'GBP', 'UAH', 'USD']).not.toContain(payloadOf(message).currency);
  });

  it('rollback-unknown-currency still voids a bet that was scored normally', () => {
    // Reproduces the worst bug this service could have: the settle is
    // scoreable, the rollback carries a currency that is not, and the points
    // still have to go away.
    const messages = plan('rollback-unknown-currency');
    const settled = messages.find((message) => message.kind === 'settled');
    const rolled = messages.find((message) => message.kind === 'rollback');

    expect(payloadOf(settled).currency).toBe('EUR');
    expect(payloadOf(rolled).currency).not.toBe('EUR');
    expect(payloadOf(rolled).betId).toBe(payloadOf(settled).betId);
  });

  it('rollback-stale-timestamp scores inside the window and voids from outside it', () => {
    // The settle has to be scoreable, or the scenario proves nothing: the
    // claim is that a stale timestamp on the rollback cannot stop the debit.
    const messages = plan('rollback-stale-timestamp');
    const settled = messages.find((message) => message.kind === 'settled');
    const rolled = messages.find((message) => message.kind === 'rollback');
    const window = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-12-01T00:00:00Z') };
    const settledAt = new Date(payloadOf(settled).settledAt);
    const rolledAt = new Date(payloadOf(rolled).settledAt);

    expect(settledAt >= window.from && settledAt < window.to).toBe(true);
    expect(rolledAt < window.from || rolledAt >= window.to).toBe(true);
    expect(payloadOf(rolled).betId).toBe(payloadOf(settled).betId);
  });

  it('out-of-window settles outside the tournament', () => {
    const [message] = plan('out-of-window');
    const settledAt = new Date(payloadOf(message).settledAt);

    expect(
      settledAt < new Date('2026-11-01T00:00:00Z') || settledAt >= new Date('2026-12-01T00:00:00Z'),
    ).toBe(true);
  });

  it('malformed publishes a body no DTO could accept', () => {
    const [message] = plan('malformed');

    expect(message?.kind).toBe('raw');
    if (message?.kind !== 'raw') throw new Error('expected a raw body');
    expect(() => {
      JSON.parse(message.body);
    }).toThrow();
  });

  it('board gives every player their own id and their own score', () => {
    // The only scenario that can show a top-100: the rest are about a single
    // player, so without it the cap and the ordering are undemonstrable with
    // the shipped producer.
    const messages = plan('board', 120);
    const players = messages.map((message) => payloadOf(message).playerId);
    const amounts = messages.map((message) => Number(payloadOf(message).winAmount));

    expect(new Set(players).size).toBe(120);
    expect(new Set(amounts).size).toBe(120);
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
  });

  it('load honours the count it was asked for', () => {
    expect(plan('load', 250)).toHaveLength(250);
  });

  it('gives every bet in a load run its own id', () => {
    const ids = plan('load', 100).map((message) => payloadOf(message).betId);

    expect(new Set(ids).size).toBe(100);
  });
});
