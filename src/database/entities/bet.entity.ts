import { Column, Entity, PrimaryColumn } from 'typeorm';
import { COLUMN_PRECISION, MONEY_SCALE, POINTS_SCALE, RATE_SCALE } from '../../common/money.js';
import { CURRENCY_MAX_LENGTH } from '../../common/currency.js';

/**
 * Lifecycle of a bet inside a tournament.
 *
 * `rollback_pending` is a tombstone: the rollback arrived before the settle,
 * so the amounts are unknown but the bet is already void. A settle landing on
 * a tombstone fills in the audit columns and scores nothing.
 */
export type BetStatus = 'settled' | 'rolled_back' | 'rollback_pending';

/**
 * The bet journal, which doubles as the idempotency journal: the primary key
 * is what makes a redelivered `bet.settled` a no-op. A separate
 * `processed_events` table would hold the same key with less information.
 *
 * NUMERIC columns are read back as strings by `pg` and deliberately left that
 * way — a `number` here is a float, and this is money.
 */
@Entity({ name: 'bets' })
export class Bet {
  @PrimaryColumn({ name: 'tournament_id', type: 'uuid' })
  tournamentId: string;

  @PrimaryColumn({ name: 'bet_id', type: 'uuid' })
  betId: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId: string;

  @Column({ type: 'text' })
  status: BetStatus;

  /** Null only on a tombstone. See CURRENCY_PATTERN for the accepted shape. */
  @Column({ type: 'varchar', length: CURRENCY_MAX_LENGTH, nullable: true })
  currency: string | null;

  @Column({ type: 'numeric', precision: COLUMN_PRECISION, scale: MONEY_SCALE, nullable: true })
  stake: string | null;

  @Column({
    name: 'win_amount',
    type: 'numeric',
    precision: COLUMN_PRECISION,
    scale: MONEY_SCALE,
    nullable: true,
  })
  winAmount: string | null;

  /** The rate the points were computed with, kept so an audit does not depend
   * on today's config. */
  @Column({
    name: 'fx_rate',
    type: 'numeric',
    precision: COLUMN_PRECISION,
    scale: RATE_SCALE,
    nullable: true,
  })
  fxRate: string | null;

  /**
   * Points actually credited for this bet. A rollback subtracts this stored
   * value instead of recomputing the formula: the configured rate may have
   * changed between the two events.
   */
  @Column({
    name: 'points_awarded',
    type: 'numeric',
    precision: COLUMN_PRECISION,
    scale: POINTS_SCALE,
    default: 0,
  })
  pointsAwarded: string;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
