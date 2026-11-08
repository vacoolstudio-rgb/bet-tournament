import { Column, Entity, PrimaryColumn } from 'typeorm';

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
  @Column({ type: 'numeric', precision: 20, scale: 6, default: 0 })
  points: string;

  /** Settled bets counted towards the tournament, losing ones included. */
  @Column({ name: 'bets_counted', type: 'int', default: 0 })
  betsCounted: number;

  /**
   * When the player last *earned* points — the tie-break for equal scores.
   *
   * Only moved by a bet that awarded more than zero, otherwise a losing bet
   * would change a player's position without changing their score. Recomputed
   * on rollback, otherwise it would keep pointing at a bet that no longer
   * counts.
   */
  @Column({ name: 'last_scored_at', type: 'timestamptz' })
  lastScoredAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
