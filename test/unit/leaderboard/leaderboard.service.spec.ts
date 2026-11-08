import { LeaderboardService } from '../../../src/leaderboard/leaderboard.service.js';
import type { PlayerScoreRow } from '../../../src/database/contracts/index.js';
import {
  ACTIVE_TOURNAMENT,
  fakePlayerScoresRepository,
  fakeTournament,
} from '../../support/fakes.js';
import { OTHER_PLAYER_ID, PLAYER_ID } from '../../support/builders.js';

const NOW = new Date('2026-11-15T12:00:00.000Z');

function row(overrides: Partial<PlayerScoreRow> = {}): PlayerScoreRow {
  return {
    playerId: PLAYER_ID,
    points: '11.232000',
    betsCounted: 3,
    lastScoredAt: new Date('2026-11-10T00:00:00.000Z'),
    ...overrides,
  };
}

function subject(top: PlayerScoreRow[] = []) {
  const scores = fakePlayerScoresRepository();
  scores.top.mockResolvedValue(top);
  scores.findOne.mockResolvedValue(null);
  const tournament = fakeTournament();

  return { service: new LeaderboardService(scores, tournament), scores, tournament };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LeaderboardService.get', () => {
  it('numbers the top from 1 in the order the repository returned', async () => {
    const { service } = subject([
      row({ playerId: PLAYER_ID, points: '1532.480000' }),
      row({ playerId: OTHER_PLAYER_ID, points: '87.120000' }),
    ]);

    const view = await service.get({ limit: 100 });

    expect(view.top.map((entry) => [entry.rank, entry.playerId])).toEqual([
      [1, PLAYER_ID],
      [2, OTHER_PLAYER_ID],
    ]);
  });

  it('reports whole points and the exact value side by side', async () => {
    // Ranking uses the exact value, so a client that only sees the rounded one
    // would find two equal scores on different rows and think it a bug.
    const { service } = subject([row({ points: '1532.480000' })]);

    const [entry] = (await service.get({ limit: 100 })).top;

    expect(entry?.points).toBe(1532);
    expect(entry?.pointsExact).toBe('1532.480000');
  });

  it('asks for exactly the limit it was given', async () => {
    const { service, scores } = subject();

    await service.get({ limit: 10 });

    expect(scores.top).toHaveBeenCalledWith({ tournamentId: ACTIVE_TOURNAMENT.id, limit: 10 });
  });

  it('describes the tournament from the window, not from a stored flag', async () => {
    const { service } = subject();

    const { tournament } = await service.get({ limit: 100 });

    expect(tournament).toEqual({
      code: 'nov-2026',
      startsAt: '2026-11-01T00:00:00.000Z',
      endsAt: '2026-12-01T00:00:00.000Z',
      status: 'active',
    });
  });

  it.each([
    ['2026-10-01T00:00:00.000Z', 'pending'],
    ['2026-11-01T00:00:00.000Z', 'active'],
    ['2026-11-30T23:59:59.999Z', 'active'],
    ['2026-12-01T00:00:00.000Z', 'finished'],
    ['2027-01-01T00:00:00.000Z', 'finished'],
  ])('at %s the tournament is %s', async (instant, status) => {
    vi.setSystemTime(new Date(instant));
    const { service } = subject();

    expect((await service.get({ limit: 100 })).tournament.status).toBe(status);
  });

  it('stamps the response with the instant it was generated', async () => {
    const { service } = subject();

    expect((await service.get({ limit: 100 })).generatedAt).toBe(NOW.toISOString());
  });

  describe('the caller’s own standing', () => {
    it('is absent when no player id was supplied', async () => {
      const { service, scores } = subject([row()]);

      const view = await service.get({ limit: 100 });

      expect(view.me).toBeNull();
      expect(scores.findOne).not.toHaveBeenCalled();
    });

    it('reuses the rank from the top instead of asking again', async () => {
      // The row is already in hand with its position; a second query would
      // only re-derive what the list just said.
      const { service, scores } = subject([
        row({ playerId: OTHER_PLAYER_ID, points: '99.000000' }),
        row({ playerId: PLAYER_ID, points: '11.232000' }),
      ]);
      scores.findOne.mockResolvedValue(row({ points: '11.232000' }));

      const view = await service.get({ limit: 100, playerId: PLAYER_ID });

      expect(view.me).toEqual({
        rank: 2,
        playerId: PLAYER_ID,
        points: 11,
        pointsExact: '11.232000',
        betsCounted: 3,
      });
      expect(scores.rankOf).not.toHaveBeenCalled();
    });

    it('counts the players above when the caller is outside the top', async () => {
      const { service, scores } = subject([row({ playerId: OTHER_PLAYER_ID })]);
      const mine = row({ points: '5.000000', betsCounted: 1 });
      scores.findOne.mockResolvedValue(mine);
      scores.rankOf.mockResolvedValue(1042);

      const view = await service.get({ limit: 1, playerId: PLAYER_ID });

      expect(scores.rankOf).toHaveBeenCalledWith({
        tournamentId: ACTIVE_TOURNAMENT.id,
        row: mine,
      });
      expect(view.me?.rank).toBe(1042);
    });

    it('answers with zeroes for a player who has never scored', async () => {
      // The caller asked about themselves, so "you have nothing yet" is the
      // answer; omitting the block would be indistinguishable from omitting
      // the header.
      const { service, scores } = subject();
      scores.findOne.mockResolvedValue(null);

      const view = await service.get({ limit: 100, playerId: PLAYER_ID });

      expect(view.me).toEqual({
        rank: null,
        playerId: PLAYER_ID,
        points: 0,
        pointsExact: '0.000000',
        betsCounted: 0,
      });
      expect(scores.rankOf).not.toHaveBeenCalled();
    });

    it('gives no rank to a player whose every bet was rolled back', async () => {
      // The equivalence that keeps the two "nothing" cases consistent:
      // rank is null exactly when points are zero, row or no row.
      const { service, scores } = subject();
      scores.findOne.mockResolvedValue(
        row({ points: '0.000000', betsCounted: 2, lastScoredAt: null }),
      );

      const view = await service.get({ limit: 100, playerId: PLAYER_ID });

      expect(view.me).toEqual({
        rank: null,
        playerId: PLAYER_ID,
        points: 0,
        pointsExact: '0.000000',
        betsCounted: 2,
      });
      expect(scores.rankOf).not.toHaveBeenCalled();
    });
  });

  it('returns an empty board rather than failing when nobody has scored', async () => {
    const { service } = subject([]);

    const view = await service.get({ limit: 100 });

    expect(view.top).toEqual([]);
    expect(view.tournament.code).toBe('nov-2026');
  });
});
