import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { floorPoints, POINTS_SCALE, toColumn } from '../common/money.js';
import { PLAYER_SCORES_REPOSITORY } from '../database/contracts/index.js';
import type { PlayerScoreRow, PlayerScoresRepositoryPort } from '../database/contracts/index.js';
import { TOURNAMENT_SERVICE } from '../scoring/scoring.contract.js';
import type { TournamentPort } from '../scoring/scoring.contract.js';
import type {
  LeaderboardEntry,
  LeaderboardPort,
  LeaderboardQuery,
  LeaderboardView,
  PlayerStanding,
  TournamentStatus,
} from './leaderboard.contract.js';

/** What a player with nothing has, at the scale the column stores. */
const NO_POINTS = toColumn(new Decimal(0), POINTS_SCALE);

@Injectable()
export class LeaderboardService implements LeaderboardPort {
  constructor(
    @Inject(PLAYER_SCORES_REPOSITORY) private readonly scores: PlayerScoresRepositoryPort,
    @Inject(TOURNAMENT_SERVICE) private readonly tournament: TournamentPort,
  ) {}

  /**
   * The top of the board plus, optionally, where one player stands.
   *
   * Two queries, not one window function over the whole table: the top is an
   * indexed `LIMIT`, and a single player's position is a count of the players
   * sorting above them. Numbering every row to answer both would scale with
   * the number of players rather than with the size of the answer.
   */
  async get({ limit, playerId }: LeaderboardQuery): Promise<LeaderboardView> {
    const active = this.tournament.getActive();
    const now = new Date();

    const rows = await this.scores.top({ tournamentId: active.id, limit });
    const top = rows.map((row, index) => this.toEntry(row, index + 1));

    return {
      tournament: {
        code: active.code,
        startsAt: active.startsAt.toISOString(),
        endsAt: active.endsAt.toISOString(),
        status: this.statusOf(now, active.startsAt, active.endsAt),
      },
      top,
      me: playerId === undefined ? null : await this.standingOf(active.id, playerId, top),
      generatedAt: now.toISOString(),
    };
  }

  private async standingOf(
    tournamentId: string,
    playerId: string,
    top: readonly LeaderboardEntry[],
  ): Promise<PlayerStanding> {
    const row = await this.scores.findOne({ tournamentId, playerId });

    // Zeroes rather than an omitted block: the caller asked about themselves,
    // and "nothing yet" is the answer. A missing `me` would be
    // indistinguishable from a missing header.
    if (row === null) {
      return { rank: null, playerId, points: 0, pointsExact: NO_POINTS, betsCounted: 0 };
    }

    const standing = {
      playerId,
      points: floorPoints(row.points),
      pointsExact: row.points,
      betsCounted: row.betsCounted,
    };

    // No points, no position — whether that is because the player never bet or
    // because every bet was rolled back. Ranking by row existence would answer
    // the same achievement two different ways.
    if (new Decimal(row.points).isZero()) {
      return { ...standing, rank: null };
    }

    // The row is already in hand with its position when the player is in the
    // top; asking again would only re-derive what the list just said.
    const inTop = top.find((entry) => entry.playerId === playerId);
    const rank = inTop?.rank ?? (await this.scores.rankOf({ tournamentId, row }));

    return { ...standing, rank };
  }

  /** Derived from the window and the current instant, never stored. */
  private statusOf(now: Date, startsAt: Date, endsAt: Date): TournamentStatus {
    if (now.getTime() < startsAt.getTime()) return 'pending';
    if (now.getTime() < endsAt.getTime()) return 'active';

    return 'finished';
  }

  private toEntry(row: PlayerScoreRow, rank: number): LeaderboardEntry {
    return {
      rank,
      playerId: row.playerId,
      // Whole points for the headline, exact points for the ordering. Two
      // players can show the same number and sit on different rows, and
      // `pointsExact` is what explains it.
      points: floorPoints(row.points),
      pointsExact: row.points,
      betsCounted: row.betsCounted,
    };
  }
}
