import type { DataSource } from 'typeorm';
import { BetsRepository } from '../../src/database/repositories/bets.repository.js';
import { PlayerScoresRepository } from '../../src/database/repositories/player-scores.repository.js';
import { TournamentsRepository } from '../../src/database/repositories/tournaments.repository.js';
import { TypeOrmUnitOfWork } from '../../src/database/unit-of-work.js';
import type { SettledBetRow, TransactionScope } from '../../src/database/contracts/index.js';
import { resetAll, startDatabase } from './support/app.js';
import { BET_ID, PLAYER_ID, SECOND_BET_ID } from '../support/builders.js';

/**
 * The SQL semantics the unit tests deliberately do not fake.
 *
 * `ON CONFLICT DO NOTHING`, a conditional `UPDATE … WHERE status = 'settled'`,
 * an atomic increment and a ranking predicate are each a claim about what
 * Postgres does, and the only honest way to check a claim about Postgres is to
 * ask Postgres.
 */
let dataSource: DataSource;
let bets: BetsRepository;
let scores: PlayerScoresRepository;
let tournaments: TournamentsRepository;
let unitOfWork: TypeOrmUnitOfWork;
let tournamentId: string;

const WINDOW = {
  code: 'nov-2026',
  startsAt: new Date('2026-11-01T00:00:00.000Z'),
  endsAt: new Date('2026-12-01T00:00:00.000Z'),
};

const SETTLED_AT = new Date('2026-11-15T10:00:00.000Z');

beforeAll(async () => {
  dataSource = await startDatabase();
  bets = new BetsRepository(dataSource);
  scores = new PlayerScoresRepository(dataSource);
  tournaments = new TournamentsRepository(dataSource);
  unitOfWork = new TypeOrmUnitOfWork(dataSource);
}, 120_000);

afterAll(async () => {
  await dataSource?.destroy();
});

beforeEach(async () => {
  await resetAll(dataSource);
  tournamentId = (await tournaments.upsertByCode(WINDOW)).id;
});

/** Runs the body in a real transaction, like the scoring service does. */
const inTransaction = <T>(work: (scope: TransactionScope) => Promise<T>): Promise<T> =>
  unitOfWork.withTransaction(work);

function settledRow(overrides: Partial<SettledBetRow> = {}): SettledBetRow {
  return {
    tournamentId,
    betId: BET_ID,
    playerId: PLAYER_ID,
    currency: 'EUR',
    stake: '10.0000',
    winAmount: '10.4000',
    fxRate: '1.08000000',
    pointsAwarded: '11.232000',
    settledAt: SETTLED_AT,
    ...overrides,
  };
}

describe('TournamentsRepository', () => {
  it('creates the configured tournament and returns its id', async () => {
    const tournament = await tournaments.findByCode({ code: 'nov-2026' });

    expect(tournament?.id).toBe(tournamentId);
    expect(tournament?.startsAt).toEqual(WINDOW.startsAt);
  });

  it('is idempotent, because it runs on every boot', async () => {
    const again = await tournaments.upsertByCode(WINDOW);

    expect(again.id).toBe(tournamentId);
  });

  it('moves the window without creating a second tournament', async () => {
    const moved = await tournaments.upsertByCode({
      ...WINDOW,
      endsAt: new Date('2027-01-01T00:00:00.000Z'),
    });

    expect(moved.id).toBe(tournamentId);
    expect(moved.endsAt).toEqual(new Date('2027-01-01T00:00:00.000Z'));
  });

  it('returns null for a code nobody configured', async () => {
    expect(await tournaments.findByCode({ code: 'dec-2026' })).toBeNull();
  });
});

describe('BetsRepository.insertSettled', () => {
  it('reports a first write as inserted', async () => {
    const result = await inTransaction((scope) => bets.insertSettled({ scope, bet: settledRow() }));

    expect(result).toBe('inserted');
  });

  it('reports a redelivery as a duplicate instead of failing', async () => {
    // This is the whole of idempotency: at-least-once delivery becomes
    // effectively-once because the second write is a no-op the caller can see.
    await inTransaction((scope) => bets.insertSettled({ scope, bet: settledRow() }));

    const second = await inTransaction((scope) => bets.insertSettled({ scope, bet: settledRow() }));

    expect(second).toBe('duplicate');
  });

  it('leaves the stored row untouched on a redelivery', async () => {
    await inTransaction((scope) => bets.insertSettled({ scope, bet: settledRow() }));
    await inTransaction((scope) =>
      bets.insertSettled({ scope, bet: settledRow({ winAmount: '999.0000' }) }),
    );

    const stored = await bets.findOne({ tournamentId, betId: BET_ID });
    expect(stored?.winAmount).toBe('10.4000');
  });

  it('stores money and points at the column scale', async () => {
    await inTransaction((scope) => bets.insertSettled({ scope, bet: settledRow() }));

    const stored = await bets.findOne({ tournamentId, betId: BET_ID });
    expect(stored).toMatchObject({
      status: 'settled',
      currency: 'EUR',
      stake: '10.0000',
      winAmount: '10.4000',
      fxRate: '1.08000000',
      pointsAwarded: '11.232000',
    });
    expect(stored?.settledAt).toEqual(SETTLED_AT);
  });

  it('fills in a tombstone and keeps the bet void', async () => {
    // A rollback arrived first, so the amounts were unknown. The late settle
    // records them for the audit trail and scores nothing.
    await inTransaction((scope) =>
      bets.insertTombstone({ scope, tournamentId, betId: BET_ID, playerId: PLAYER_ID }),
    );

    const result = await inTransaction((scope) => bets.insertSettled({ scope, bet: settledRow() }));

    expect(result).toBe('tombstone_filled');
    const stored = await bets.findOne({ tournamentId, betId: BET_ID });
    expect(stored?.status).toBe('rolled_back');
    expect(stored?.winAmount).toBe('10.4000');
    expect(stored?.pointsAwarded).toBe('0.000000');
  });

  it('treats a settle that follows a completed rollback as a duplicate', async () => {
    await inTransaction((scope) => bets.insertSettled({ scope, bet: settledRow() }));
    await inTransaction((scope) => bets.markRolledBack({ scope, tournamentId, betId: BET_ID }));

    const result = await inTransaction((scope) => bets.insertSettled({ scope, bet: settledRow() }));

    expect(result).toBe('duplicate');
  });

  it('keeps two tournaments apart, even for the same bet id', async () => {
    const other = await tournaments.upsertByCode({
      code: 'dec-2026',
      startsAt: new Date('2026-12-01T00:00:00.000Z'),
      endsAt: new Date('2027-01-01T00:00:00.000Z'),
    });

    await inTransaction((scope) => bets.insertSettled({ scope, bet: settledRow() }));
    const result = await inTransaction((scope) =>
      bets.insertSettled({ scope, bet: settledRow({ tournamentId: other.id }) }),
    );

    expect(result).toBe('inserted');
  });
});

describe('BetsRepository.markRolledBack', () => {
  it('voids a settled bet and reports what it had scored', async () => {
    await inTransaction((scope) => bets.insertSettled({ scope, bet: settledRow() }));

    const voided = await inTransaction((scope) =>
      bets.markRolledBack({ scope, tournamentId, betId: BET_ID }),
    );

    expect(voided).toEqual({ playerId: PLAYER_ID, pointsAwarded: '11.232000' });
    expect((await bets.findOne({ tournamentId, betId: BET_ID }))?.status).toBe('rolled_back');
  });

  it('reports nothing the second time, which is what stops a double debit', async () => {
    await inTransaction((scope) => bets.insertSettled({ scope, bet: settledRow() }));
    await inTransaction((scope) => bets.markRolledBack({ scope, tournamentId, betId: BET_ID }));

    const again = await inTransaction((scope) =>
      bets.markRolledBack({ scope, tournamentId, betId: BET_ID }),
    );

    expect(again).toBeNull();
  });

  it('reports nothing for a bet it has never seen', async () => {
    const voided = await inTransaction((scope) =>
      bets.markRolledBack({ scope, tournamentId, betId: BET_ID }),
    );

    expect(voided).toBeNull();
  });
});

describe('BetsRepository.insertTombstone', () => {
  it('records a rollback for a bet that has not settled yet', async () => {
    const inserted = await inTransaction((scope) =>
      bets.insertTombstone({ scope, tournamentId, betId: BET_ID, playerId: PLAYER_ID }),
    );

    expect(inserted).toBe(true);
    const stored = await bets.findOne({ tournamentId, betId: BET_ID });
    expect(stored).toMatchObject({ status: 'rollback_pending', pointsAwarded: '0.000000' });
    expect(stored?.currency).toBeNull();
    expect(stored?.settledAt).toBeNull();
  });

  it('reports false when a row is already there, instead of raising a conflict', async () => {
    // Two rollbacks racing each other is a no-op, not an error.
    await inTransaction((scope) =>
      bets.insertTombstone({ scope, tournamentId, betId: BET_ID, playerId: PLAYER_ID }),
    );

    const again = await inTransaction((scope) =>
      bets.insertTombstone({ scope, tournamentId, betId: BET_ID, playerId: PLAYER_ID }),
    );

    expect(again).toBe(false);
  });
});

describe('BetsRepository.latestScoringSettledAt', () => {
  const earlier = new Date('2026-11-05T00:00:00.000Z');
  const later = new Date('2026-11-20T00:00:00.000Z');

  it('returns the latest settle among the bets that still score', async () => {
    await inTransaction(async (scope) => {
      await bets.insertSettled({ scope, bet: settledRow({ betId: BET_ID, settledAt: earlier }) });
      await bets.insertSettled({
        scope,
        bet: settledRow({ betId: SECOND_BET_ID, settledAt: later }),
      });
    });

    const latest = await inTransaction((scope) =>
      bets.latestScoringSettledAt({ scope, tournamentId, playerId: PLAYER_ID }),
    );

    expect(latest).toEqual(later);
  });

  it('ignores a bet that was rolled back', async () => {
    await inTransaction(async (scope) => {
      await bets.insertSettled({ scope, bet: settledRow({ betId: BET_ID, settledAt: earlier }) });
      await bets.insertSettled({
        scope,
        bet: settledRow({ betId: SECOND_BET_ID, settledAt: later }),
      });
    });
    await inTransaction((scope) =>
      bets.markRolledBack({ scope, tournamentId, betId: SECOND_BET_ID }),
    );

    const latest = await inTransaction((scope) =>
      bets.latestScoringSettledAt({ scope, tournamentId, playerId: PLAYER_ID }),
    );

    expect(latest).toEqual(earlier);
  });

  it('ignores a bet that scored nothing', async () => {
    // A losing bet is not when the player last earned points.
    await inTransaction(async (scope) => {
      await bets.insertSettled({ scope, bet: settledRow({ betId: BET_ID, settledAt: earlier }) });
      await bets.insertSettled({
        scope,
        bet: settledRow({
          betId: SECOND_BET_ID,
          settledAt: later,
          winAmount: '0.0000',
          pointsAwarded: '0.000000',
        }),
      });
    });

    const latest = await inTransaction((scope) =>
      bets.latestScoringSettledAt({ scope, tournamentId, playerId: PLAYER_ID }),
    );

    expect(latest).toEqual(earlier);
  });

  it('returns null when the player has nothing left that scores', async () => {
    expect(
      await inTransaction((scope) =>
        bets.latestScoringSettledAt({ scope, tournamentId, playerId: PLAYER_ID }),
      ),
    ).toBeNull();
  });
});

describe('concurrency', () => {
  it('lets exactly one of two identical settles through', async () => {
    // The race the unit tests cannot stage: two consumers handed the same
    // redelivered event at the same moment. One insert wins, the other has to
    // come back as `duplicate` rather than as a constraint violation, because
    // only the winner may credit the aggregate.
    const results = await Promise.all([
      inTransaction((scope) => bets.insertSettled({ scope, bet: settledRow() })),
      inTransaction((scope) => bets.insertSettled({ scope, bet: settledRow() })),
    ]);

    expect(results.filter((result) => result === 'inserted')).toHaveLength(1);
    expect(results.filter((result) => result === 'duplicate')).toHaveLength(1);
  });

  it('lets exactly one of two concurrent rollbacks void the bet', async () => {
    // Two rollbacks arriving together must subtract once. The conditional
    // update is what decides it: the second transaction waits on the row lock,
    // then matches nothing because the status has moved on.
    await inTransaction((scope) => bets.insertSettled({ scope, bet: settledRow() }));

    const voided = await Promise.all([
      inTransaction((scope) => bets.markRolledBack({ scope, tournamentId, betId: BET_ID })),
      inTransaction((scope) => bets.markRolledBack({ scope, tournamentId, betId: BET_ID })),
    ]);

    expect(voided.filter((result) => result !== null)).toHaveLength(1);
    expect(voided.filter((result) => result === null)).toHaveLength(1);
  });

  it('lets exactly one of two concurrent tombstones through', async () => {
    const inserted = await Promise.all([
      inTransaction((scope) =>
        bets.insertTombstone({ scope, tournamentId, betId: BET_ID, playerId: PLAYER_ID }),
      ),
      inTransaction((scope) =>
        bets.insertTombstone({ scope, tournamentId, betId: BET_ID, playerId: PLAYER_ID }),
      ),
    ]);

    expect(inserted.filter(Boolean)).toHaveLength(1);
  });
});

describe('more than one tournament', () => {
  it('voids a bet only within the tournament it is asked about', async () => {
    // A documented limitation, pinned so it stays deliberate. Rollbacks are
    // addressed by (active tournament, betId), so a rollback that arrives
    // after the tournament it belongs to has ended writes a tombstone in the
    // current one and leaves the finished tournament's points standing. With a
    // single active tournament this is unreachable; with two it would need the
    // event to name its tournament, which the task's schema does not.
    const past = await tournaments.upsertByCode({
      code: 'oct-2026',
      startsAt: new Date('2026-10-01T00:00:00.000Z'),
      endsAt: new Date('2026-11-01T00:00:00.000Z'),
    });
    await inTransaction((scope) =>
      bets.insertSettled({ scope, bet: settledRow({ tournamentId: past.id }) }),
    );

    const voided = await inTransaction((scope) =>
      bets.markRolledBack({ scope, tournamentId, betId: BET_ID }),
    );

    expect(voided).toBeNull();
    expect((await bets.findOne({ tournamentId: past.id, betId: BET_ID }))?.status).toBe('settled');
  });
});

describe('PlayerScoresRepository.credit', () => {
  const settledAt = SETTLED_AT;

  it('creates the row on the first scoring bet', async () => {
    await inTransaction((scope) =>
      scores.credit({ scope, tournamentId, playerId: PLAYER_ID, points: '11.232000', settledAt }),
    );

    expect(await scores.findOne({ tournamentId, playerId: PLAYER_ID })).toEqual({
      playerId: PLAYER_ID,
      points: '11.232000',
      betsCounted: 1,
      lastScoredAt: settledAt,
    });
  });

  it('adds to the running total rather than replacing it', async () => {
    await inTransaction((scope) =>
      scores.credit({ scope, tournamentId, playerId: PLAYER_ID, points: '11.232000', settledAt }),
    );
    await inTransaction((scope) =>
      scores.credit({ scope, tournamentId, playerId: PLAYER_ID, points: '0.768000', settledAt }),
    );

    const row = await scores.findOne({ tournamentId, playerId: PLAYER_ID });
    expect(row?.points).toBe('12.000000');
    expect(row?.betsCounted).toBe(2);
  });

  it('survives concurrent credits for the same player without losing one', async () => {
    // The reason this is an upsert with an increment and not a read, add,
    // write: a lost increment never comes back, and no retry can notice.
    await Promise.all(
      Array.from({ length: 25 }, () =>
        inTransaction((scope) =>
          scores.credit({
            scope,
            tournamentId,
            playerId: PLAYER_ID,
            points: '1.000000',
            settledAt,
          }),
        ),
      ),
    );

    const row = await scores.findOne({ tournamentId, playerId: PLAYER_ID });
    expect(row?.points).toBe('25.000000');
    expect(row?.betsCounted).toBe(25);
  });

  it('counts a losing bet but leaves the tie-break key unset', async () => {
    // Zero points is not a moment of scoring, and the CHECK constraint allows
    // the key to stay null only because the points are zero.
    await inTransaction((scope) =>
      scores.credit({ scope, tournamentId, playerId: PLAYER_ID, points: '0.000000', settledAt }),
    );

    expect(await scores.findOne({ tournamentId, playerId: PLAYER_ID })).toEqual({
      playerId: PLAYER_ID,
      points: '0.000000',
      betsCounted: 1,
      lastScoredAt: null,
    });
  });

  it('does not let a later losing bet move the tie-break key', async () => {
    // Otherwise a loss would push a player down among equal scores without
    // changing the score.
    await inTransaction((scope) =>
      scores.credit({ scope, tournamentId, playerId: PLAYER_ID, points: '5.000000', settledAt }),
    );
    await inTransaction((scope) =>
      scores.credit({
        scope,
        tournamentId,
        playerId: PLAYER_ID,
        points: '0.000000',
        settledAt: new Date('2026-11-20T00:00:00.000Z'),
      }),
    );

    const row = await scores.findOne({ tournamentId, playerId: PLAYER_ID });
    expect(row?.lastScoredAt).toEqual(settledAt);
    expect(row?.betsCounted).toBe(2);
  });

  it('keeps the latest scoring moment when events arrive out of order', async () => {
    await inTransaction((scope) =>
      scores.credit({
        scope,
        tournamentId,
        playerId: PLAYER_ID,
        points: '1.000000',
        settledAt: new Date('2026-11-20T00:00:00.000Z'),
      }),
    );
    await inTransaction((scope) =>
      scores.credit({
        scope,
        tournamentId,
        playerId: PLAYER_ID,
        points: '1.000000',
        settledAt: new Date('2026-11-05T00:00:00.000Z'),
      }),
    );

    expect((await scores.findOne({ tournamentId, playerId: PLAYER_ID }))?.lastScoredAt).toEqual(
      new Date('2026-11-20T00:00:00.000Z'),
    );
  });
});

describe('PlayerScoresRepository.debit', () => {
  beforeEach(async () => {
    await inTransaction((scope) =>
      scores.credit({
        scope,
        tournamentId,
        playerId: PLAYER_ID,
        points: '11.232000',
        settledAt: SETTLED_AT,
      }),
    );
  });

  it('subtracts the points and the bet, and resets the tie-break key', async () => {
    await inTransaction((scope) =>
      scores.debit({
        scope,
        tournamentId,
        playerId: PLAYER_ID,
        points: '11.232000',
        lastScoredAt: null,
      }),
    );

    expect(await scores.findOne({ tournamentId, playerId: PLAYER_ID })).toEqual({
      playerId: PLAYER_ID,
      points: '0.000000',
      betsCounted: 0,
      lastScoredAt: null,
    });
  });

  it('assigns the recomputed key rather than keeping the old one', async () => {
    const remaining = new Date('2026-11-05T00:00:00.000Z');

    await inTransaction((scope) =>
      scores.debit({
        scope,
        tournamentId,
        playerId: PLAYER_ID,
        points: '1.232000',
        lastScoredAt: remaining,
      }),
    );

    const row = await scores.findOne({ tournamentId, playerId: PLAYER_ID });
    expect(row?.points).toBe('10.000000');
    expect(row?.lastScoredAt).toEqual(remaining);
  });

  it('refuses to drive a score below zero', async () => {
    // Unreachable through the service, which only debits a bet it just moved
    // out of `settled`. The constraint is what makes that reasoning checkable.
    await expect(
      inTransaction((scope) =>
        scores.debit({
          scope,
          tournamentId,
          playerId: PLAYER_ID,
          points: '99.000000',
          lastScoredAt: null,
        }),
      ),
    ).rejects.toThrow(/player_scores_points_non_negative/);
  });

  it('refuses to debit a player who has no aggregate row', async () => {
    // Unreachable through the service: a bet can only be voided after it was
    // credited, which creates the row. If it ever happens, the journal and the
    // aggregate have drifted, and a silent no-op would keep points that no bet
    // accounts for.
    await expect(
      inTransaction((scope) =>
        scores.debit({
          scope,
          tournamentId,
          playerId: '12121212-1212-4121-8121-121212121212',
          points: '1.000000',
          lastScoredAt: null,
        }),
      ),
    ).rejects.toThrow();
  });

  it('drops only the tally when a losing bet is voided', async () => {
    await inTransaction((scope) =>
      scores.decrementCounted({ scope, tournamentId, playerId: PLAYER_ID }),
    );

    const row = await scores.findOne({ tournamentId, playerId: PLAYER_ID });
    expect(row?.points).toBe('11.232000');
    expect(row?.betsCounted).toBe(0);
  });
});

describe('PlayerScoresRepository.top and rankOf', () => {
  const player = (n: number): string => `55555555-5555-4555-8555-00000000000${n}`;
  const at = (day: number): Date => new Date(`2026-11-${String(day).padStart(2, '0')}T00:00:00Z`);

  async function seed(
    rows: { playerId: string; points: string; settledAt: Date | null }[],
  ): Promise<void> {
    await inTransaction(async (scope) => {
      for (const row of rows) {
        await scores.credit({
          scope,
          tournamentId,
          playerId: row.playerId,
          points: row.points,
          settledAt: row.settledAt ?? at(1),
        });
      }
    });
  }

  it('orders by points, then by who got there first, then by id', async () => {
    await seed([
      { playerId: player(1), points: '50.000000', settledAt: at(20) },
      { playerId: player(2), points: '90.000000', settledAt: at(10) },
      { playerId: player(3), points: '50.000000', settledAt: at(5) },
    ]);

    const top = await scores.top({ tournamentId, limit: 10 });

    expect(top.map((row) => row.playerId)).toEqual([player(2), player(3), player(1)]);
  });

  it('breaks a complete tie by player id, so the order never wobbles', async () => {
    await seed([
      { playerId: player(2), points: '50.000000', settledAt: at(10) },
      { playerId: player(1), points: '50.000000', settledAt: at(10) },
    ]);

    const top = await scores.top({ tournamentId, limit: 10 });

    expect(top.map((row) => row.playerId)).toEqual([player(1), player(2)]);
  });

  it('puts players who never scored last', async () => {
    await seed([
      { playerId: player(1), points: '0.000000', settledAt: null },
      { playerId: player(2), points: '1.000000', settledAt: at(10) },
    ]);

    const top = await scores.top({ tournamentId, limit: 10 });

    expect(top.map((row) => row.playerId)).toEqual([player(2), player(1)]);
    expect(top[1]?.lastScoredAt).toBeNull();
  });

  it('returns no more than the limit', async () => {
    await seed([
      { playerId: player(1), points: '10.000000', settledAt: at(10) },
      { playerId: player(2), points: '20.000000', settledAt: at(10) },
      { playerId: player(3), points: '30.000000', settledAt: at(10) },
    ]);

    expect(await scores.top({ tournamentId, limit: 2 })).toHaveLength(2);
  });

  it('agrees with the order of the top it is ranking within', async () => {
    // The position has to be computed by the same key the list is sorted by,
    // or a player sees a rank that contradicts the row they are standing on.
    await seed([
      { playerId: player(1), points: '50.000000', settledAt: at(20) },
      { playerId: player(2), points: '90.000000', settledAt: at(10) },
      { playerId: player(3), points: '50.000000', settledAt: at(5) },
    ]);

    const top = await scores.top({ tournamentId, limit: 10 });
    const ranks = await Promise.all(top.map((row) => scores.rankOf({ tournamentId, row })));

    expect(ranks).toEqual([1, 2, 3]);
  });

  it('ranks a complete tie by player id, exactly as the top does', async () => {
    // Exercises the last branch of the ranking predicate. If the two
    // orderings disagree here, a player sees a position that contradicts the
    // row they are standing on.
    await seed([
      { playerId: player(2), points: '50.000000', settledAt: at(10) },
      { playerId: player(1), points: '50.000000', settledAt: at(10) },
    ]);
    const first = await scores.findOne({ tournamentId, playerId: player(1) });
    const second = await scores.findOne({ tournamentId, playerId: player(2) });

    expect(await scores.rankOf({ tournamentId, row: first! })).toBe(1);
    expect(await scores.rankOf({ tournamentId, row: second! })).toBe(2);
  });

  it('counts only the players strictly above a row', async () => {
    await seed([
      { playerId: player(1), points: '90.000000', settledAt: at(10) },
      { playerId: player(2), points: '50.000000', settledAt: at(10) },
    ]);
    const row = await scores.findOne({ tournamentId, playerId: player(2) });

    expect(await scores.rankOf({ tournamentId, row: row! })).toBe(2);
  });

  it('agrees with a window function over the whole table, ties and nulls included', async () => {
    // Stronger than the hand-built cases above: the predicate is checked
    // against an independent formulation of the same order, on a board built
    // to contain every awkward shape at once — equal scores, equal scores at
    // the same instant, and players who never scored.
    //
    // A ranking predicate is easy to get subtly wrong (a `>=` where a `>`
    // belongs, a NULL comparison that silently yields false), and such a bug
    // shows up as a position that contradicts the list the player is looking
    // at, which is exactly the sort of thing nobody reports clearly.
    const rows = Array.from({ length: 40 }, (_, index) => ({
      playerId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, '0')}`,
      points: index % 5 === 0 ? '0.000000' : `${(index % 4) * 10}.000000`,
      settledAt: index % 3 === 0 ? at(10) : at(20),
    }));
    await seed(
      rows.map((row) => ({ ...row, settledAt: row.points === '0.000000' ? null : row.settledAt })),
    );

    const reference = await dataSource.query<{ player_id: string; rank: string }[]>(
      `SELECT player_id,
              row_number() OVER (
                ORDER BY points DESC, last_scored_at ASC NULLS LAST, player_id ASC
              ) AS rank
         FROM player_scores WHERE tournament_id = $1`,
      [tournamentId],
    );

    for (const expected of reference) {
      const row = await scores.findOne({ tournamentId, playerId: expected.player_id });
      if (row === null) throw new Error(`seeded row ${expected.player_id} vanished`);
      // Only players with points have a position at all.
      if (row.points === '0.000000') continue;

      expect(await scores.rankOf({ tournamentId, row })).toBe(Number(expected.rank));
    }
  });

  it('returns null for a player with no row at all', async () => {
    expect(await scores.findOne({ tournamentId, playerId: player(9) })).toBeNull();
  });
});
