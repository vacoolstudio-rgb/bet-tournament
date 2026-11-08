import { TournamentService } from '../../../src/scoring/tournament.service.js';
import { ACTIVE_TOURNAMENT, fakeConfig, fakeTournamentsRepository } from '../../support/fakes.js';

function subject() {
  const tournaments = fakeTournamentsRepository();
  tournaments.upsertByCode.mockResolvedValue({
    ...ACTIVE_TOURNAMENT,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
  });

  return { service: new TournamentService(fakeConfig(), tournaments), tournaments };
}

describe('TournamentService.onModuleInit', () => {
  it('makes the configured tournament exist, because config is the source of truth', async () => {
    const { service, tournaments } = subject();

    await service.onModuleInit();

    expect(tournaments.upsertByCode).toHaveBeenCalledWith({
      code: 'nov-2026',
      startsAt: ACTIVE_TOURNAMENT.startsAt,
      endsAt: ACTIVE_TOURNAMENT.endsAt,
    });
  });

  it('caches the row, so scoring does not query for it per event', async () => {
    const { service, tournaments } = subject();

    await service.onModuleInit();
    service.getActive();
    service.getActive();

    expect(tournaments.upsertByCode).toHaveBeenCalledTimes(1);
    expect(service.getActive()).toEqual(ACTIVE_TOURNAMENT);
  });
});

describe('TournamentService.getActive', () => {
  it('fails loudly before initialisation rather than inventing a tournament', () => {
    const { service } = subject();

    expect(() => service.getActive()).toThrow();
  });
});

describe('TournamentService.isWithinWindow', () => {
  it('includes the first instant of the window', async () => {
    const { service } = subject();
    await service.onModuleInit();

    expect(service.isWithinWindow(new Date('2026-11-01T00:00:00.000Z'))).toBe(true);
  });

  it('excludes the last instant, so adjacent tournaments cannot both count a bet', async () => {
    const { service } = subject();
    await service.onModuleInit();

    expect(service.isWithinWindow(new Date('2026-12-01T00:00:00.000Z'))).toBe(false);
  });

  it('accepts the instant just before the end', async () => {
    const { service } = subject();
    await service.onModuleInit();

    expect(service.isWithinWindow(new Date('2026-11-30T23:59:59.999Z'))).toBe(true);
  });

  it('rejects the instant just before the start', async () => {
    const { service } = subject();
    await service.onModuleInit();

    expect(service.isWithinWindow(new Date('2026-10-31T23:59:59.999Z'))).toBe(false);
  });

  it.each([
    ['long before', '2020-01-01T00:00:00.000Z', false],
    ['mid-tournament', '2026-11-15T10:00:00.000Z', true],
    ['long after', '2030-01-01T00:00:00.000Z', false],
  ])('is %s the window', async (_case, instant, expected) => {
    const { service } = subject();
    await service.onModuleInit();

    expect(service.isWithinWindow(new Date(instant))).toBe(expected);
  });
});
