import {
  buildTopology,
  EXCHANGE_BETS,
  EXCHANGE_PARKED,
  EXCHANGE_RETRY,
  QUEUE_BETS,
  QUEUE_PARKED,
  QUEUE_RETRY,
  ROUTING_KEY_ROLLBACK,
  ROUTING_KEY_SETTLED,
} from '../../../src/messaging/topology.js';

const topology = buildTopology({ retryTtlMs: 10_000 });

function queue(name: string) {
  const found = topology.queues.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`topology has no queue ${name}`);

  return found;
}

describe('buildTopology', () => {
  it('declares every exchange as a durable topic', () => {
    expect(topology.exchanges.map((exchange) => exchange.name)).toEqual([
      EXCHANGE_BETS,
      EXCHANGE_RETRY,
      EXCHANGE_PARKED,
    ]);
    expect(topology.exchanges.every((exchange) => exchange.type === 'topic')).toBe(true);
    expect(topology.exchanges.every((exchange) => exchange.options.durable)).toBe(true);
  });

  describe('the main queue', () => {
    it('is a quorum queue, so a settled bet survives a broker restart', () => {
      expect(queue(QUEUE_BETS).options.arguments['x-queue-type']).toBe('quorum');
      expect(queue(QUEUE_BETS).options.durable).toBe(true);
    });

    it('dead-letters to the retry exchange, not to the parking one', () => {
      // This is the whole shape of the retry policy: a rejected message has to
      // land in the TTL queue and come back. Pointing this at the parking
      // exchange would turn every transient database error into a parked
      // event.
      expect(queue(QUEUE_BETS).options.arguments['x-dead-letter-exchange']).toBe(EXCHANGE_RETRY);
    });

    it('keeps a delivery limit as a backstop against an endless loop', () => {
      expect(queue(QUEUE_BETS).options.arguments['x-delivery-limit']).toBe(20);
    });

    it('binds both event types', () => {
      expect(queue(QUEUE_BETS).bindings).toEqual([
        { exchange: EXCHANGE_BETS, routingKey: ROUTING_KEY_SETTLED },
        { exchange: EXCHANGE_BETS, routingKey: ROUTING_KEY_ROLLBACK },
      ]);
    });
  });

  describe('the retry queue', () => {
    it('is classic, because per-queue message TTL is unconditional there', () => {
      expect(queue(QUEUE_RETRY).options.arguments['x-queue-type']).toBe('classic');
    });

    it('takes its delay from config', () => {
      expect(
        buildTopology({ retryTtlMs: 250 }).queues.find((q) => q.name === QUEUE_RETRY)?.options
          .arguments['x-message-ttl'],
      ).toBe(250);
    });

    it('dead-letters back to the main exchange, which is what makes it a retry', () => {
      expect(queue(QUEUE_RETRY).options.arguments['x-dead-letter-exchange']).toBe(EXCHANGE_BETS);
    });

    it('binds the same routing keys, so the key survives the round trip', () => {
      expect(queue(QUEUE_RETRY).bindings.map((binding) => binding.routingKey)).toEqual([
        ROUTING_KEY_SETTLED,
        ROUTING_KEY_ROLLBACK,
      ]);
    });
  });

  describe('the parking queue', () => {
    it('has no dead-letter target of its own: it is the end of the line', () => {
      expect(queue(QUEUE_PARKED).options.arguments['x-dead-letter-exchange']).toBeUndefined();
    });

    it('has no TTL, so nothing expires before a human looks at it', () => {
      expect(queue(QUEUE_PARKED).options.arguments['x-message-ttl']).toBeUndefined();
    });
  });
});
