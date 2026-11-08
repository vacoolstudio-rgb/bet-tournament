/**
 * Returns parked messages to the main exchange.
 *
 *   npm run replay -- --dry-run     what is in the parking queue and why
 *   npm run replay                  put it all back
 *   npm run replay -- --limit=10    put back the first ten
 *
 * Parking is only half of a policy: a message is parked because it could not
 * succeed *yet* — a currency missing from the config, a producer bug since
 * fixed — and without a way back, "parked" and "lost" are the same word.
 *
 * Plain amqplib rather than the reconnecting manager the service uses: this is
 * a short drain run by a human, and a tool that silently reconnects and starts
 * again is not what anyone wants while moving messages around by hand.
 */
import { connect } from 'amqplib';
import type { ConfirmChannel, GetMessage } from 'amqplib';
import { loadConfig } from '../src/config/app-config.js';
import {
  EXCHANGE_BETS,
  HEADER_PARK_AT,
  HEADER_PARK_ATTEMPTS,
  HEADER_PARK_ERROR,
  HEADER_PARK_REASON,
  HEADER_PARK_ROUTING_KEY,
  HEADER_X_DEATH,
  QUEUE_PARKED,
  ROUTING_KEY_ROLLBACK,
  ROUTING_KEY_SETTLED,
} from '../src/messaging/topology.js';

/** Headers that describe the previous life of the message, not its next one. */
const STALE_HEADERS = [
  HEADER_X_DEATH,
  HEADER_PARK_REASON,
  HEADER_PARK_ERROR,
  HEADER_PARK_ROUTING_KEY,
  HEADER_PARK_ATTEMPTS,
  HEADER_PARK_AT,
];

export const HEADER_REPLAYED_AT = 'x-replayed-at';

const KNOWN_KEYS = new Set<string>([ROUTING_KEY_SETTLED, ROUTING_KEY_ROLLBACK]);

export interface ReplayOptions {
  readonly limit: number;
  readonly dryRun: boolean;
}

export interface ReplaySummary {
  readonly replayed: number;
  readonly skipped: number;
}

/** A parked message, reduced to what replaying it needs. */
export interface ParkedMessage {
  readonly headers: Readonly<Record<string, unknown>>;
  readonly body: string;
}

/**
 * Decides where a parked message goes back to.
 *
 * The routing key it arrived with was stored when it was parked, because the
 * parking queue is bound to one key of its own and the original would
 * otherwise be lost. A message without a recognisable key is left in place:
 * guessing would be worse than leaving it for a human.
 */
export function routingKeyFor(message: ParkedMessage): string | undefined {
  const stored = message.headers[HEADER_PARK_ROUTING_KEY];

  return typeof stored === 'string' && KNOWN_KEYS.has(stored) ? stored : undefined;
}

/**
 * Strips what the previous attempt left behind.
 *
 * `x-death` matters most: the attempt counter is derived from it, so a replayed
 * message carrying the old record would start its new life several attempts in
 * and be parked again early. The park headers go too — they describe a failure
 * that has supposedly been fixed — and a replay stamp goes on, so a message
 * that comes back a second time says so.
 */
export function headersFor(message: ParkedMessage): Record<string, unknown> {
  const headers: Record<string, unknown> = { ...message.headers };

  for (const stale of STALE_HEADERS) delete headers[stale];
  headers[HEADER_REPLAYED_AT] = new Date().toISOString();

  return headers;
}

const asParked = (message: GetMessage): ParkedMessage => ({
  headers: message.properties.headers ?? {},
  body: message.content.toString('utf8'),
});

async function drain(
  channel: ConfirmChannel,
  { limit, dryRun }: ReplayOptions,
): Promise<ReplaySummary> {
  let replayed = 0;
  let skipped = 0;
  // Messages this run is not consuming are left unacknowledged until the end
  // rather than requeued one at a time. Requeued immediately, each goes back
  // to the head of the queue and the next `get` picks up the same one — a dry
  // run over a single message printed it `--limit` times.
  let held = 0;

  for (let taken = 0; taken < limit; taken += 1) {
    const message = await channel.get(QUEUE_PARKED, { noAck: false });
    if (message === false) break;

    const parked = asParked(message);
    const routingKey = routingKeyFor(parked);
    const reason = parked.headers[HEADER_PARK_REASON];

    if (dryRun) {
      console.log(
        `  ${String(reason)} -> ${routingKey ?? 'НЕИЗВЕСТНЫЙ КЛЮЧ'}: ${parked.body.slice(0, 120)}`,
      );
      held += 1;
      if (routingKey === undefined) skipped += 1;
      else replayed += 1;
      continue;
    }

    if (routingKey === undefined) {
      console.warn(`  пропущено (${String(reason)}): в заголовках нет известного routing key`);
      held += 1;
      skipped += 1;
      continue;
    }

    channel.publish(EXCHANGE_BETS, routingKey, message.content, {
      persistent: true,
      headers: headersFor(parked),
    });
    // Confirmed first, acknowledged second: the message leaves the parking
    // queue only once the broker has taken responsibility for its copy.
    await channel.waitForConfirms();
    channel.ack(message);
    replayed += 1;
  }

  // Everything untouched goes back, in one step: a dry run changes nothing,
  // and a real run leaves what it could not route for a human to look at.
  if (held > 0) channel.nackAll(true);

  return { replayed, skipped };
}

export async function replay(options: ReplayOptions): Promise<ReplaySummary> {
  const config = loadConfig();
  const connection = await connect(config.rabbit.url);

  try {
    const channel = await connection.createConfirmChannel();

    try {
      return await drain(channel, options);
    } finally {
      await channel.close();
    }
  } finally {
    await connection.close();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const limit = Number(
    argv.find((argument) => argument.startsWith('--limit='))?.split('=')[1] ?? 10_000,
  );
  const dryRun = argv.includes('--dry-run');

  console.log(dryRun ? 'Парковка содержит:' : 'Возвращаю запаркованные сообщения:');
  const { replayed, skipped } = await replay({ limit, dryRun });

  console.log(
    dryRun
      ? `Готовы к возврату: ${replayed}, без известного routing key: ${skipped}`
      : `Возвращено: ${replayed}, пропущено: ${skipped}`,
  );
}

if (
  process.argv[1]?.endsWith('replay.ts') === true ||
  process.argv[1]?.endsWith('replay.js') === true
) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
