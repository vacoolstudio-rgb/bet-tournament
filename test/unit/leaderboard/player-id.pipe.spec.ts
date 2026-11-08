import { BadRequestException } from '@nestjs/common';
import { PlayerIdPipe } from '../../../src/leaderboard/player-id.pipe.js';
import { PLAYER_ID } from '../../support/builders.js';

const pipe = new PlayerIdPipe();

describe('PlayerIdPipe', () => {
  it('passes a valid player id through', () => {
    expect(pipe.transform(PLAYER_ID)).toBe(PLAYER_ID);
  });

  it('accepts an uppercase id, since UUIDs are case insensitive', () => {
    expect(pipe.transform(PLAYER_ID.toUpperCase())).toBe(PLAYER_ID.toUpperCase());
  });

  it('treats an absent header as "no caller"', () => {
    // The leaderboard is public; without the header the response simply
    // carries no `me` block.
    expect(pipe.transform(undefined)).toBeUndefined();
  });

  it.each([
    ['an empty header', ''],
    ['a whitespace-only header', '   '],
  ])('treats %s as absent', (_case, value) => {
    expect(pipe.transform(value)).toBeUndefined();
  });

  it('trims a header that arrived with padding', () => {
    expect(pipe.transform(` ${PLAYER_ID} `)).toBe(PLAYER_ID);
  });

  it.each([
    ['free text', 'player-1'],
    ['a number', '42'],
    ['a truncated uuid', PLAYER_ID.slice(0, 20)],
    ['a uuid with a trailing character', `${PLAYER_ID}x`],
  ])('rejects %s', (_case, value) => {
    // Rejected rather than ignored: answering "you have no points" to a player
    // who has some is worse than an error.
    expect(() => pipe.transform(value)).toThrow(BadRequestException);
  });
});
