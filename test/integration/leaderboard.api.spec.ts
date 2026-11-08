import type { DataSource } from 'typeorm';
import { resetDatabase, startApp, startDatabase } from './support/app.js';
import type { Harness } from './support/app.js';
import { PLAYER_ID } from '../support/builders.js';

/**
 * The read path on its own.
 *
 * Rows are seeded with SQL rather than by publishing events: the question here
 * is what the endpoint answers for a given state of the table, and routing
 * that through the consumer would make a write-path bug look like an API bug.
 */
let app: Harness;
let dataSource: DataSource;
let tournamentId: string;

const player = (n: number): string => `99999999-9999-4999-8999-00000000000${n}`;

beforeAll(async () => {
  dataSource = await startDatabase();
  app = await startApp();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await dataSource?.destroy();
});

beforeEach(async () => {
  await resetDatabase(dataSource);
  const [row] = await dataSource.query<{ id: string }[]>(
    `INSERT INTO tournaments (id, code, starts_at, ends_at)
     VALUES (gen_random_uuid(), 'nov-2026', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z')
     RETURNING id`,
  );
  tournamentId = row!.id;
});

async function seed(
  rows: { playerId: string; points: string; betsCounted?: number; lastScoredAt: string | null }[],
): Promise<void> {
  for (const row of rows) {
    await dataSource.query(
      `INSERT INTO player_scores
         (tournament_id, player_id, points, bets_counted, last_scored_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [tournamentId, row.playerId, row.points, row.betsCounted ?? 1, row.lastScoredAt],
    );
  }
}

describe('GET /leaderboard', () => {
  it('answers with an empty board before anyone has scored', async () => {
    const response = await app.http.get('/leaderboard').expect(200);

    expect(response.body.top).toEqual([]);
    expect(response.body.me).toBeNull();
    expect(response.body.tournament).toMatchObject({ code: 'nov-2026', status: 'active' });
    expect(typeof response.body.generatedAt).toBe('string');
  });

  it('ranks by exact points and reports both the whole and the exact value', async () => {
    await seed([
      { playerId: player(1), points: '1532.480000', lastScoredAt: '2026-11-10T00:00:00Z' },
      { playerId: player(2), points: '87.120000', lastScoredAt: '2026-11-11T00:00:00Z' },
    ]);

    const { body } = await app.http.get('/leaderboard').expect(200);

    expect(body.top).toEqual([
      {
        rank: 1,
        playerId: player(1),
        points: 1532,
        pointsExact: '1532.480000',
        betsCounted: 1,
      },
      { rank: 2, playerId: player(2), points: 87, pointsExact: '87.120000', betsCounted: 1 },
    ]);
  });

  it('puts whoever reached an equal score first above the other', async () => {
    await seed([
      { playerId: player(1), points: '50.000000', lastScoredAt: '2026-11-20T00:00:00Z' },
      { playerId: player(2), points: '50.000000', lastScoredAt: '2026-11-05T00:00:00Z' },
    ]);

    const { body } = await app.http.get('/leaderboard').expect(200);

    const top = body.top as { playerId: string }[];
    expect(top.map((entry) => entry.playerId)).toEqual([player(2), player(1)]);
  });

  it('honours a smaller limit', async () => {
    await seed([
      { playerId: player(1), points: '30.000000', lastScoredAt: '2026-11-10T00:00:00Z' },
      { playerId: player(2), points: '20.000000', lastScoredAt: '2026-11-10T00:00:00Z' },
      { playerId: player(3), points: '10.000000', lastScoredAt: '2026-11-10T00:00:00Z' },
    ]);

    const { body } = await app.http.get('/leaderboard?limit=2').expect(200);

    expect(body.top).toHaveLength(2);
    expect(body.top[0].rank).toBe(1);
  });

  it('caps the board at a hundred rows', async () => {
    await seed(
      Array.from({ length: 105 }, (_, index) => ({
        playerId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
        points: `${1000 - index}.000000`,
        lastScoredAt: '2026-11-10T00:00:00Z',
      })),
    );

    const { body } = await app.http.get('/leaderboard').expect(200);

    expect(body.top).toHaveLength(100);
  });

  describe('the caller’s own standing', () => {
    it('is reported with the rank it holds inside the top', async () => {
      await seed([
        { playerId: player(1), points: '90.000000', lastScoredAt: '2026-11-10T00:00:00Z' },
        {
          playerId: PLAYER_ID,
          points: '50.000000',
          betsCounted: 6,
          lastScoredAt: '2026-11-11T00:00:00Z',
        },
      ]);

      const { body } = await app.http.get('/leaderboard').set('X-Player-Id', PLAYER_ID).expect(200);

      expect(body.me).toEqual({
        rank: 2,
        playerId: PLAYER_ID,
        points: 50,
        pointsExact: '50.000000',
        betsCounted: 6,
      });
    });

    it('is reported with a real position even from outside the top', async () => {
      await seed([
        { playerId: player(1), points: '90.000000', lastScoredAt: '2026-11-10T00:00:00Z' },
        { playerId: player(2), points: '80.000000', lastScoredAt: '2026-11-10T00:00:00Z' },
        { playerId: PLAYER_ID, points: '1.000000', lastScoredAt: '2026-11-10T00:00:00Z' },
      ]);

      const { body } = await app.http
        .get('/leaderboard?limit=2')
        .set('X-Player-Id', PLAYER_ID)
        .expect(200);

      expect(body.top).toHaveLength(2);
      expect(body.me.rank).toBe(3);
    });

    it('answers with zeroes for a player who has never bet', async () => {
      await seed([
        { playerId: player(1), points: '90.000000', lastScoredAt: '2026-11-10T00:00:00Z' },
      ]);

      const { body } = await app.http.get('/leaderboard').set('X-Player-Id', PLAYER_ID).expect(200);

      expect(body.me).toEqual({
        rank: null,
        playerId: PLAYER_ID,
        points: 0,
        pointsExact: '0.000000',
        betsCounted: 0,
      });
    });

    it('gives the same answer to a player whose every bet was rolled back', async () => {
      // One has a row and the other does not, but neither has scored, so the
      // tournament has no position for either.
      await seed([
        { playerId: player(1), points: '90.000000', lastScoredAt: '2026-11-10T00:00:00Z' },
        { playerId: PLAYER_ID, points: '0.000000', betsCounted: 2, lastScoredAt: null },
      ]);

      const { body } = await app.http.get('/leaderboard').set('X-Player-Id', PLAYER_ID).expect(200);

      expect(body.me).toEqual({
        rank: null,
        playerId: PLAYER_ID,
        points: 0,
        pointsExact: '0.000000',
        betsCounted: 2,
      });
    });
  });

  describe('bad requests', () => {
    it.each([
      ['a limit of zero', '/leaderboard?limit=0'],
      ['a limit above the cap', '/leaderboard?limit=101'],
      ['a limit that is not a number', '/leaderboard?limit=many'],
    ])('rejects %s', async (_case, url) => {
      const { body } = await app.http.get(url).expect(400);

      expect(body.statusCode).toBe(400);
      expect(JSON.stringify(body.message)).toContain('limit');
    });

    it('rejects a player id that is not a player id', async () => {
      // Ignoring it would answer "you have no points" to a player who has
      // some.
      await app.http.get('/leaderboard').set('X-Player-Id', 'player-1').expect(400);
    });

    it('treats an empty player id header as no header at all', async () => {
      const { body } = await app.http.get('/leaderboard').set('X-Player-Id', '').expect(200);

      expect(body.me).toBeNull();
    });
  });

  describe('the tournament block', () => {
    it.each([
      ['2026-10-15T00:00:00.000Z', '2026-10-31T00:00:00.000Z', 'finished'],
      ['2030-01-01T00:00:00.000Z', '2030-02-01T00:00:00.000Z', 'pending'],
    ])('reports a window of %s..%s as %s', async (startsAt, endsAt, status) => {
      const other = await startApp({
        tournament: { code: 'nov-2026', startsAt: new Date(startsAt), endsAt: new Date(endsAt) },
      });

      try {
        const { body } = await other.http.get('/leaderboard').expect(200);

        expect(body.tournament.status).toBe(status);
      } finally {
        await other.close();
      }
    });
  });
});

describe('the operational endpoints', () => {
  it('reports healthy while both dependencies are reachable', async () => {
    const { body } = await app.http.get('/health').expect(200);

    expect(body.status).toBe('ok');
    expect(Object.keys(body.info ?? {})).toEqual(expect.arrayContaining(['database', 'broker']));
  });

  it('serves metrics in the format Prometheus expects', async () => {
    const response = await app.http.get('/metrics').expect(200);

    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('bet_events_acknowledged_total');
  });

  it('documents the API', async () => {
    await app.http.get('/api/docs-json').expect(200);
  });
});
