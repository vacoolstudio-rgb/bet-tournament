import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * A scoring window. The config is the source of truth for the active
 * tournament; this row exists for referential integrity and so a second
 * tournament does not require a schema change.
 */
@Entity({ name: 'tournaments' })
export class Tournament {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'text', unique: true })
  code: string;

  /** Inclusive. */
  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  /** Exclusive. */
  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
