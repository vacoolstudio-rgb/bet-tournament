import { Column, Entity, PrimaryColumn } from 'typeorm';
import { COLUMN_PRECISION, POINTS_SCALE } from '../../common/money.js';

/**
 * The leaderboard aggregate: one row per player per tournament, maintained by
 * atomic upserts so that concurrent consumers never read-modify-write.
 */
@Entity({ name: 'player_scores' })
export class PlayerScore {
  @PrimaryColumn({ name: 'tournament_id', type: 'uuid' })
  tournamentId: string;

  @PrimaryColumn({ name: 'player_id', type: 'uuid' })
  playerId: string;

  /** Exact points; the API exposes both this and its floor. */
  @Column({ type: 'numeric', precision: COLUMN_PRECISION, scale: POINTS_SCALE, default: 0 })
  points: string;

  /** Settled bets counted towards the tournament, losing ones included. */
  @Column({ name: 'bets_counted', type: 'int', default: 0 })
  betsCounted: number;

  /**
   * When the player last *earned* points — the tie-break for equal scores.
   *
   * Null means "has never scored", which is a state a row really can be in: a
   * player whose first bet lost has a row with zero points, and a player whose
   * every bet was rolled back is back to that state. Writing a timestamp there
   * anyway would claim they scored at a moment they did not, and the tie-break
   * would read it as "reached this score first".
   *
   * Only moved by a bet that awarded more than zero, otherwise a losing bet
   * would change a player's position without changing their score. Recomputed
   * on rollback from the bets that still count.
   */
  @Column({ name: 'last_scored_at', type: 'timestamptz', nullable: true })
  lastScoredAt: Date | null;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
