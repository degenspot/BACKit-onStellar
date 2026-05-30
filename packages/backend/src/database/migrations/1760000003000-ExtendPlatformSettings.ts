import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendPlatformSettings1760000003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "platform_settings"
      ADD COLUMN IF NOT EXISTS "minStake" decimal(20,7) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_settings"
      ADD COLUMN IF NOT EXISTS "maxDuration" integer NOT NULL DEFAULT 86400
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_settings"
      ADD COLUMN IF NOT EXISTS "supportedTokens" jsonb NOT NULL DEFAULT '[]'
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_settings"
      ADD COLUMN IF NOT EXISTS "contractAddresses" jsonb NOT NULL DEFAULT '{}'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN IF EXISTS "contractAddresses"`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN IF EXISTS "supportedTokens"`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN IF EXISTS "maxDuration"`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN IF EXISTS "minStake"`,
    );
  }
}
