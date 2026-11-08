/**
 * AMQP topology.
 *
 * Two outcomes are deliberately kept apart, and that split is the reason the
 * topology has four names instead of two:
 *
 *   retryable  nack(requeue=false) -> bets.retry -> tournament.retry (TTL)
 *              -> back to `bets` with the original routing key
 *   poison     published straight to tournament.parked, original acked
 *
 * Requeueing in place would redeliver instantly, so a two-second database
 * outage would burn every attempt in milliseconds and park live events. The
 * TTL hop is what buys the pause.
 */
export const EXCHANGE_BETS = 'bets';
export const EXCHANGE_RETRY = 'bets.retry';
export const EXCHANGE_PARKED = 'bets.parked';

export const QUEUE_BETS = 'tournament.bets';
export const QUEUE_RETRY = 'tournament.retry';
export const QUEUE_PARKED = 'tournament.parked';

export const ROUTING_KEY_SETTLED = 'bet.settled';
export const ROUTING_KEY_ROLLBACK = 'bet.rollback';
export const ROUTING_KEY_PARKED = 'parked';

/** Why a message was parked, and what it was. Read by humans and by tests. */
export const HEADER_PARK_REASON = 'x-park-reason';
export const HEADER_PARK_ERROR = 'x-park-error';
export const HEADER_PARK_ROUTING_KEY = 'x-park-routing-key';
export const HEADER_PARK_ATTEMPTS = 'x-park-attempts';

export interface TopologyOptions {
  /** How long a failed message waits before coming back. */
  readonly retryTtlMs: number;
}

export interface ExchangeDefinition {
  readonly name: string;
  readonly type: 'topic' | 'fanout' | 'direct';
  readonly options: { readonly durable: true };
}

export interface QueueDefinition {
  readonly name: string;
  readonly options: {
    readonly durable: true;
    readonly arguments: Readonly<Record<string, string | number>>;
  };
  readonly bindings: readonly { readonly exchange: string; readonly routingKey: string }[];
}

export interface Topology {
  readonly exchanges: readonly ExchangeDefinition[];
  readonly queues: readonly QueueDefinition[];
}

/**
 * The declarative topology, built from config so the retry delay is tunable
 * without touching code. Returned as data rather than applied here so the
 * tests can assert the arguments that actually matter — the dead-letter
 * target, the TTL and the delivery limit.
 */
export function buildTopology({ retryTtlMs }: TopologyOptions): Topology {
  return {
    exchanges: [
      { name: EXCHANGE_BETS, type: 'topic', options: { durable: true } },
      { name: EXCHANGE_RETRY, type: 'topic', options: { durable: true } },
      { name: EXCHANGE_PARKED, type: 'topic', options: { durable: true } },
    ],
    queues: [
      {
        name: QUEUE_BETS,
        options: {
          durable: true,
          arguments: {
            // Quorum for a queue that must not lose a settled bet to a broker
            // restart.
            'x-queue-type': 'quorum',
            'x-dead-letter-exchange': EXCHANGE_RETRY,
            // Not the retry mechanism — a backstop. If a bug in the consumer
            // makes every delivery fail, this stops the TTL loop from running
            // forever.
            'x-delivery-limit': 20,
          },
        },
        bindings: [
          { exchange: EXCHANGE_BETS, routingKey: ROUTING_KEY_SETTLED },
          { exchange: EXCHANGE_BETS, routingKey: ROUTING_KEY_ROLLBACK },
        ],
      },
      {
        name: QUEUE_RETRY,
        options: {
          durable: true,
          arguments: {
            // Classic, not quorum: per-queue message TTL is supported there
            // without version caveats. Nothing consumes this queue — expiry
            // dead-letters the message back to `bets` with its original
            // routing key, which is the whole trick.
            'x-queue-type': 'classic',
            'x-message-ttl': retryTtlMs,
            'x-dead-letter-exchange': EXCHANGE_BETS,
          },
        },
        bindings: [
          { exchange: EXCHANGE_RETRY, routingKey: ROUTING_KEY_SETTLED },
          { exchange: EXCHANGE_RETRY, routingKey: ROUTING_KEY_ROLLBACK },
        ],
      },
      {
        name: QUEUE_PARKED,
        options: { durable: true, arguments: { 'x-queue-type': 'quorum' } },
        bindings: [{ exchange: EXCHANGE_PARKED, routingKey: ROUTING_KEY_PARKED }],
      },
    ],
  };
}
