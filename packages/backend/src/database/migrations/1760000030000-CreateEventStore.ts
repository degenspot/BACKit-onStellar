import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Event sourcing audit trail (Issue #533).
 *
 * Creates the append-only `event_store` table plus `aggregate_snapshots`
 * for compaction. Append-only is enforced twice over: EventStoreService
 * never exposes an update/delete method, and — belt and suspenders, since a
 * stray `UPDATE event_store ...` in a psql session would otherwise silently
 * corrupt history — BEFORE UPDATE/DELETE triggers reject any mutation at
 * the database layer.
 */
export class CreateEventStore1760000030000 implements MigrationInterface {
  name = 'CreateEventStore1760000030000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "event_store_aggregate_type_enum" AS ENUM (
          'CALL', 'USER', 'STAKE', 'PAYOUT', 'ORACLE', 'ADMIN'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "event_store_event_type_enum" AS ENUM (
          'call.created',
          'call.resolved',
          'stake.placed',
          'stake.withdrawn',
          'payout.claimed',
          'user.registered',
          'user.followed',
          'admin.action',
          'oracle.submitted'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "event_store" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sequence"        bigserial NOT NULL,
        "aggregateType"   "event_store_aggregate_type_enum" NOT NULL,
        "aggregateId"     character varying(128) NOT NULL,
        "eventType"       "event_store_event_type_enum" NOT NULL,
        "payload"         jsonb NOT NULL,
        "metadata"        jsonb,
        "ledgerSequence"  bigint,
        "createdAt"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_event_store" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_event_store_sequence"
        ON "event_store" ("sequence")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_event_store_aggregate"
        ON "event_store" ("aggregateType", "aggregateId", "sequence")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_event_store_aggregateType"
        ON "event_store" ("aggregateType")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_event_store_createdAt"
        ON "event_store" ("createdAt")
    `);

    // ── Append-only enforcement ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION event_store_prevent_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'event_store is append-only: % is not permitted', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER "trg_event_store_no_update"
        BEFORE UPDATE ON "event_store"
        FOR EACH ROW EXECUTE FUNCTION event_store_prevent_mutation()
    `);

    await queryRunner.query(`
      CREATE TRIGGER "trg_event_store_no_delete"
        BEFORE DELETE ON "event_store"
        FOR EACH ROW EXECUTE FUNCTION event_store_prevent_mutation()
    `);

    // ── Compaction snapshots ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "aggregate_snapshots" (
        "id"            uuid NOT NULL DEFAULT uuid_generate_v4(),
        "aggregateType" "event_store_aggregate_type_enum" NOT NULL,
        "aggregateId"   character varying(128) NOT NULL,
        "sequence"      bigint NOT NULL,
        "version"       integer NOT NULL,
        "state"         jsonb NOT NULL,
        "createdAt"     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_aggregate_snapshots" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_aggregate_snapshots_lookup"
        ON "aggregate_snapshots" ("aggregateType", "aggregateId", "sequence" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_aggregate_snapshots_lookup"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "aggregate_snapshots"`);

    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_event_store_no_delete" ON "event_store"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_event_store_no_update" ON "event_store"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS event_store_prevent_mutation()`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_event_store_createdAt"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_event_store_aggregateType"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_event_store_aggregate"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_event_store_sequence"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "event_store"`);

    await queryRunner.query(
      `DROP TYPE IF EXISTS "event_store_event_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "event_store_aggregate_type_enum"`,
    );
  }
}
