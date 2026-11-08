import { Decimal } from 'decimal.js';
import { PoisonMessageError, UnknownCurrencyError } from '../../../src/common/errors.js';
import { MAX_EVENT_BYTES } from '../../../src/messaging/contracts/index.js';
import { BetEventProcessor } from '../../../src/messaging/bet-event.processor.js';
import { ROUTING_KEY_ROLLBACK, ROUTING_KEY_SETTLED } from '../../../src/messaging/topology.js';
import type { ScoringPort } from '../../../src/scoring/scoring.contract.js';
import { rollbackEvent, settledEvent } from '../../support/builders.js';

/** A delivery of a realistic size; the limit has its own tests. */
function delivery(routingKey: string, payload: unknown) {
  return { routingKey, payload, sizeBytes: JSON.stringify(payload ?? '').length };
}

function scoringFake() {
  return {
    settle: vi.fn<ScoringPort['settle']>(),
    rollback: vi.fn<ScoringPort['rollback']>(),
  };
}

describe('BetEventProcessor', () => {
  describe('bet.settled', () => {
    it('normalises the payload into a command before the domain sees it', async () => {
      const scoring = scoringFake();
      scoring.settle.mockResolvedValue({ status: 'scored', pointsAwarded: '11.232000' });
      const processor = new BetEventProcessor(scoring);

      await processor.process(
        delivery(ROUTING_KEY_SETTLED, settledEvent({ stake: 10, winAmount: '10.4000' })),
      );

      const command = scoring.settle.mock.calls[0]?.[0];
      // Amounts arrive as Decimal and the timestamp as a Date: the domain
      // never re-decides what "10.4000" means.
      expect(command?.winAmount).toBeInstanceOf(Decimal);
      expect(command?.winAmount.toString()).toBe('10.4');
      expect(command?.stake.toString()).toBe('10');
      expect(command?.settledAt).toBeInstanceOf(Date);
      expect(command?.settledAt.toISOString()).toBe('2026-11-15T10:00:00.000Z');
      expect(command?.currency).toBe('EUR');
    });

    it.each([
      [{ status: 'scored', pointsAwarded: '11.232000' }, 'scored'],
      [{ status: 'scored_zero' }, 'scored_zero'],
      [{ status: 'duplicate' }, 'duplicate'],
      [{ status: 'already_rolled_back' }, 'already_rolled_back'],
      [{ status: 'out_of_window' }, 'out_of_window'],
    ] as const)('reports %j as its ack reason', async (outcome, reason) => {
      const scoring = scoringFake();
      scoring.settle.mockResolvedValue(outcome);

      await expect(
        new BetEventProcessor(scoring).process(delivery(ROUTING_KEY_SETTLED, settledEvent())),
      ).resolves.toBe(reason);
    });

    it('rejects a malformed payload without touching the domain', async () => {
      const scoring = scoringFake();

      await expect(
        new BetEventProcessor(scoring).process(
          delivery(ROUTING_KEY_SETTLED, settledEvent({ settledAt: '2026-11-15T10:00:00' })),
        ),
      ).rejects.toThrow(PoisonMessageError);
      expect(scoring.settle).not.toHaveBeenCalled();
    });

    it('lets an unconfigured currency surface as its own poison reason', async () => {
      const scoring = scoringFake();
      scoring.settle.mockRejectedValue(new UnknownCurrencyError('XYZ'));

      await expect(
        new BetEventProcessor(scoring).process(
          delivery(ROUTING_KEY_SETTLED, settledEvent({ currency: 'XYZ' })),
        ),
      ).rejects.toBeInstanceOf(UnknownCurrencyError);
    });
  });

  describe('bet.rollback', () => {
    it('passes nothing but the identity to the domain', async () => {
      const scoring = scoringFake();
      scoring.rollback.mockResolvedValue({ status: 'rolled_back', pointsRemoved: '11.232000' });

      // The regression this guards: a rollback carrying a currency that is no
      // longer configured, and a settledAt outside the tournament window.
      // Both must be ignored, or the points stay credited forever.
      await new BetEventProcessor(scoring).process(
        delivery(
          ROUTING_KEY_ROLLBACK,
          rollbackEvent({
            currency: 'XYZ',
            settledAt: '2020-01-01T00:00:00.000Z',
            winAmount: '999.0000',
          }),
        ),
      );

      expect(scoring.rollback).toHaveBeenCalledWith({
        betId: rollbackEvent().betId,
        playerId: rollbackEvent().playerId,
      });
    });

    it.each([
      [{ status: 'rolled_back', pointsRemoved: '11.232000' }, 'rolled_back'],
      [{ status: 'tombstoned' }, 'tombstoned'],
      [{ status: 'duplicate' }, 'duplicate'],
    ] as const)('reports %j as its ack reason', async (outcome, reason) => {
      const scoring = scoringFake();
      scoring.rollback.mockResolvedValue(outcome);

      await expect(
        new BetEventProcessor(scoring).process(delivery(ROUTING_KEY_ROLLBACK, rollbackEvent())),
      ).resolves.toBe(reason);
    });

    it('rejects a rollback with no betId', async () => {
      const scoring = scoringFake();

      await expect(
        new BetEventProcessor(scoring).process(
          delivery(ROUTING_KEY_ROLLBACK, { playerId: rollbackEvent().playerId }),
        ),
      ).rejects.toThrow(PoisonMessageError);
      expect(scoring.rollback).not.toHaveBeenCalled();
    });
  });

  describe('an oversized body', () => {
    it('is refused by size, before anything walks its structure', async () => {
      // A bet event is a few hundred bytes. Refusing by size costs the same
      // whatever the body contains, which is the point: the expensive shapes
      // are exactly the ones an attacker would choose.
      const scoring = scoringFake();

      try {
        await new BetEventProcessor(scoring).process({
          routingKey: ROUTING_KEY_SETTLED,
          payload: settledEvent(),
          sizeBytes: MAX_EVENT_BYTES + 1,
        });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(PoisonMessageError);
        expect((error as PoisonMessageError).reason).toBe('invalid_schema');
      }

      expect(scoring.settle).not.toHaveBeenCalled();
    });

    it('accepts a body right at the limit', async () => {
      const scoring = scoringFake();
      scoring.settle.mockResolvedValue({ status: 'scored', pointsAwarded: '11.232000' });

      await expect(
        new BetEventProcessor(scoring).process({
          routingKey: ROUTING_KEY_SETTLED,
          payload: settledEvent(),
          sizeBytes: MAX_EVENT_BYTES,
        }),
      ).resolves.toBe('scored');
    });
  });

  describe('an unexpected routing key', () => {
    it('is parked rather than guessed at', async () => {
      const scoring = scoringFake();

      try {
        await new BetEventProcessor(scoring).process(delivery('bet.cashout', settledEvent()));
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(PoisonMessageError);
        expect((error as PoisonMessageError).reason).toBe('unknown_routing_key');
      }

      expect(scoring.settle).not.toHaveBeenCalled();
      expect(scoring.rollback).not.toHaveBeenCalled();
    });
  });
});
