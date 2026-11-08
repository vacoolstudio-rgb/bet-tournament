import type { DataSource } from 'typeorm';
import { inject } from 'vitest';
import { EXCHANGE_BETS, QUEUE_RETRY, ROUTING_KEY_SETTLED } from '../../src/messaging/topology.js';
import { resetAll, resetBroker, startApp, startDatabase } from './support/app.js';
import type { Harness } from './support/app.js';
import { deleteQueue, killConnection, listConnections, queueExists } from './support/broker.js';
import type { Broker } from './support/broker.js';
import { PLAYER_ID, settledEvent } from '../support/builders.js';

/**
 * What happens when the connection goes away underneath a running service.
 *
 * This is the one branch of the AMQP layer that cannot be reasoned about from
 * the code: the setup function is supposed to run again on every reconnection,
 * re-asserting the topology and restarting the consumers. Either it does or it
 * does not, and the only way to find out is to sever the connection and watch.
 *
 * The connection is closed from the broker's side through the management API,
 * which is what a partition or a broker restart looks like to a client — the
 * socket disappears without a protocol-level goodbye. Nothing is restarted
 * here on purpose: the service has to notice and recover on its own.
 */
let app: Harness;
let broker: Broker;
let dataSource: DataSource;

const SERVICE_CONNECTION = 'bet-tournament';

beforeAll(async () => {
  dataSource = await startDatabase();
  broker = await resetBroker();
  app = await startApp();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await broker?.close();
  await dataSource?.destroy();
});

beforeEach(async () => {
  await resetAll(dataSource);
  await app.close();
  app = await startApp();
});

async function points(): Promise<string | undefined> {
  const [row] = await dataSource.query<{ points: string }[]>(
    `SELECT points FROM player_scores WHERE player_id = $1`,
    [PLAYER_ID],
  );

  return row?.points;
}

/** Connections the service opened, as the broker reports them. */
async function serviceConnections(): Promise<string[]> {
  const connections = await listConnections(inject('managementUrl'));

  return connections
    .filter((connection) => connection.client_properties?.connection_name === SERVICE_CONNECTION)
    .map((connection) => connection.name);
}

/**
 * Waits for the broker to admit the service's connection exists.
 *
 * The management plugin publishes connection statistics on an interval, so a
 * socket that is already open and working does not appear in `/api/connections`
 * for a few seconds. Reading the list once is how this suite first "passed"
 * while severing nothing at all.
 */
async function awaitServiceConnections(timeoutMs = 20_000): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;

  do {
    const names = await serviceConnections();
    if (names.length > 0) return names;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);

  throw new Error(
    `The broker never reported a connection named "${SERVICE_CONNECTION}". ` +
      `Without one there is nothing to sever, and a test that severs nothing proves nothing.`,
  );
}

/**
 * Severs the service's connection, and only the service's.
 *
 * The suite holds a connection of its own which has no reconnection logic, so
 * closing everything would break the test rather than the subject. The client
 * property the broker names connections from is what makes them
 * distinguishable — and is the reason the production code sets one.
 *
 * Throws rather than returning zero: every test here is meaningless unless
 * something was actually cut.
 */
async function severService(): Promise<number> {
  const names = await awaitServiceConnections();

  for (const name of names) {
    await killConnection(inject('managementUrl'), name);
  }

  return names.length;
}

describe('when the broker closes the connection', () => {
  it('identifies its own connection by name, so an operator can too', async () => {
    await expect(awaitServiceConnections()).resolves.not.toHaveLength(0);
  }, 60_000);

  it('reports itself unhealthy while the connection is gone', async () => {
    // Readiness has to mean "events are being handled". While the connection
    // is down they are piling up in the queue untouched, and a cheerful 200
    // would keep the instance in the load balancer and the alert silent.
    expect(await severService()).toBeGreaterThan(0);

    await expect
      .poll(async () => (await app.http.get('/health')).status, { timeout: 20_000 })
      .toBe(503);
  }, 60_000);

  it('comes back and keeps scoring without being restarted', async () => {
    expect(await severService()).toBeGreaterThan(0);

    // Not waiting for health to flap first: what matters is that an event
    // published during or after the outage is eventually scored, whichever
    // order those happen in.
    broker.publish(EXCHANGE_BETS, ROUTING_KEY_SETTLED, settledEvent());

    await expect.poll(points, { timeout: 30_000 }).toBe('11.232000');
    await expect
      .poll(async () => (await app.http.get('/health')).status, { timeout: 30_000 })
      .toBe(200);
  }, 90_000);

  it('re-declares a queue that disappeared while it was away', async () => {
    // The self-healing claim, made checkable: the retry queue is deleted
    // behind the service's back — safe, because nothing consumes it — and the
    // reconnection has to bring it, and its bindings, back. A broker restarted
    // without its definitions is the real version of this.
    await deleteQueue(inject('managementUrl'), QUEUE_RETRY);
    expect(await queueExists(inject('managementUrl'), QUEUE_RETRY)).toBe(false);

    expect(await severService()).toBeGreaterThan(0);

    await expect
      .poll(() => queueExists(inject('managementUrl'), QUEUE_RETRY), { timeout: 30_000 })
      .toBe(true);
  }, 90_000);

  it('loses no event that was in flight when the socket went away', async () => {
    // Unacknowledged deliveries return to the queue when the channel dies, so
    // at-least-once survives the outage: the bet is scored exactly once, by
    // whichever delivery got through.
    broker.publish(EXCHANGE_BETS, ROUTING_KEY_SETTLED, settledEvent());
    expect(await severService()).toBeGreaterThan(0);

    await expect.poll(points, { timeout: 30_000 }).toBe('11.232000');

    // And once, not twice: the journal is what makes the redelivery harmless.
    const [row] = await dataSource.query<{ bets_counted: number }[]>(
      `SELECT bets_counted FROM player_scores WHERE player_id = $1`,
      [PLAYER_ID],
    );
    expect(row?.bets_counted).toBe(1);
  }, 90_000);
});
