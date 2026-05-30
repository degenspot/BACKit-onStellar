import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCallsSearchVector1760000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "calls"
      ADD COLUMN IF NOT EXISTS "searchVector" tsvector
    `);

    await queryRunner.query(`
      UPDATE "calls"
      SET "searchVector" =
        to_tsvector(
          'simple',
          COALESCE("title", '') || ' ' ||
          COALESCE("thesis", '') || ' ' ||
          COALESCE("pairId", '')
        )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_calls_search_vector"
      ON "calls" USING GIN ("searchVector")
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION calls_search_vector_update()
      RETURNS trigger AS $$
      BEGIN
        NEW."searchVector" :=
          to_tsvector(
            'simple',
            COALESCE(NEW."title", '') || ' ' ||
            COALESCE(NEW."thesis", '') || ' ' ||
            COALESCE(NEW."pairId", '')
          );
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_calls_search_vector_update ON "calls"
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_calls_search_vector_update
      BEFORE INSERT OR UPDATE OF "title", "thesis", "pairId"
      ON "calls"
      FOR EACH ROW
      EXECUTE FUNCTION calls_search_vector_update()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_calls_search_vector_update ON "calls"
    `);
    await queryRunner.query(`DROP FUNCTION IF EXISTS calls_search_vector_update`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_calls_search_vector"`);
    await queryRunner.query(`
      ALTER TABLE "calls"
      DROP COLUMN IF EXISTS "searchVector"
    `);
  }
}
