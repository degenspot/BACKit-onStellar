import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOracleHealthLogs1760000004000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "oracle_health_logs_operation_enum" AS ENUM ('fetch', 'sign', 'submit');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "oracle_health_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "oracleKey" character varying NOT NULL,
        "callId" character varying,
        "operation" "oracle_health_logs_operation_enum" NOT NULL,
        "submissionTime" TIMESTAMP NOT NULL,
        "priceFetched" decimal(20,8),
        "success" boolean NOT NULL DEFAULT false,
        "errorMessage" text,
        "latencyMs" integer NOT NULL DEFAULT 0,
        "expectedPrice" decimal(20,8),
        "deviationPercent" decimal(10,4),
        "deviationBreached" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_oracle_health_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_oracle_health_logs_submission_time"
      ON "oracle_health_logs" ("submissionTime")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_oracle_health_logs_submission_time"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "oracle_health_logs"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "oracle_health_logs_operation_enum"`,
    );
  }
}
