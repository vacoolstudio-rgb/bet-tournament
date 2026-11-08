import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema: tournaments, the bet journal and the leaderboard aggregate.
 *
 * Written as SQL rather than generated from entities, because the parts that
 * matter here — partial indexes, CHECK constraints and the exact ordering
 * index for the leaderboard — are not expressible through decorators.
 */
export class InitialSchema1762603200000 implements MigrationInterface {
  name = 'InitialSchema1762603200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tournaments (
        id          uuid        PRIMARY KEY,
        code        text        NOT NULL UNIQUE,
        starts_at   timestamptz NOT NULL,
        ends_at     timestamptz NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT tournaments_window_ordered CHECK (ends_at > starts_at)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE bets (
        tournament_id  uuid          NOT NULL REFERENCES tournaments(id),
        bet_id         uuid          NOT NULL,
        player_id      uuid          NOT NULL,
        status         text          NOT NULL,
        currency       char(3)       NULL,
        stake          numeric(20,4) NULL,
        win_amount     numeric(20,4) NULL,
        fx_rate        numeric(20,8) NULL,
        points_awarded numeric(20,6) NOT NULL DEFAULT 0,
        settled_at     timestamptz   NULL,
        created_at     timestamptz   NOT NULL DEFAULT now(),
        updated_at     timestamptz   NOT NULL DEFAULT now(),
        PRIMARY KEY (tournament_id, bet_id),
        CONSTRAINT bets_status_known CHECK (
          status IN ('settled', 'rolled_back', 'rollback_pending')
        ),
        -- A tombstone from an early rollback knows nothing but the identity of
        -- the bet; every other status knows the amounts it was scored from.
        CONSTRAINT bets_tombstone_scores_nothing CHECK (
          status <> 'rollback_pending' OR points_awarded = 0
        ),
        CONSTRAINT bets_settled_has_amounts CHECK (
          status = 'rollback_pending' OR (
            currency   IS NOT NULL AND
            stake      IS NOT NULL AND
            win_amount IS NOT NULL AND
            fx_rate    IS NOT NULL AND
            settled_at IS NOT NULL
          )
        ),
        CONSTRAINT bets_amounts_non_negative CHECK (
          (stake      IS NULL OR stake      >= 0) AND
          (win_amount IS NULL OR win_amount >= 0) AND
          (fx_rate    IS NULL OR fx_rate    >  0) AND
          points_awarded >= 0
        )
      )
    `);

    // Rollback recomputes last_scored_at as max(settled_at) over the player's
    // remaining scoring bets; this partial index is that query's whole cost.
    await queryRunner.query(`
      CREATE INDEX bets_scoring_by_player_idx
        ON bets (tournament_id, player_id, settled_at DESC)
        WHERE status = 'settled' AND points_awarded > 0
    `);

    await queryRunner.query(`
      CREATE TABLE player_scores (
        tournament_id  uuid          NOT NULL REFERENCES tournaments(id),
        player_id      uuid          NOT NULL,
        points         numeric(20,6) NOT NULL DEFAULT 0,
        bets_counted   int           NOT NULL DEFAULT 0,
        last_scored_at timestamptz   NOT NULL,
        updated_at     timestamptz   NOT NULL DEFAULT now(),
        PRIMARY KEY (tournament_id, player_id),
        -- Points are only ever subtracted on the settled -> rolled_back
        -- transition, which happens once and for the stored amount, so these
        -- can never trip. They are here to catch the day that stops being true.
        CONSTRAINT player_scores_points_non_negative CHECK (points >= 0),
        CONSTRAINT player_scores_bets_non_negative  CHECK (bets_counted >= 0)
      )
    `);

    // The exact ordering of the leaderboard: score first, then who reached it
    // first, then the id as a deterministic last resort.
    await queryRunner.query(`
      CREATE INDEX player_scores_leaderboard_idx
        ON player_scores (tournament_id, points DESC, last_scored_at ASC, player_id ASC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE player_scores`);
    await queryRunner.query(`DROP TABLE bets`);
    await queryRunner.query(`DROP TABLE tournaments`);
  }
}
