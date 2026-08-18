import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWebhookTables1760000040000 implements MigrationInterface {
  name = 'CreateWebhookTables1760000040000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "webhook_subscriptions" (
        "id"           UUID                     NOT NULL DEFAULT uuid_generate_v4(),
        "userAddress"  VARCHAR                  NOT NULL,
        "url"          TEXT                     NOT NULL,
        "secret"       TEXT                     NOT NULL,
        "events"       TEXT                     NOT NULL,
        "isActive"     BOOLEAN                  NOT NULL DEFAULT true,
        "createdAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhook_subscriptions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_webhook_sub_user"   ON "webhook_subscriptions" ("userAddress");
      CREATE INDEX "IDX_webhook_sub_active" ON "webhook_subscriptions" ("isActive");
    `);

    await queryRunner.query(`
      CREATE TABLE "webhook_delivery_logs" (
        "id"             UUID                     NOT NULL DEFAULT uuid_generate_v4(),
        "subscriptionId" UUID                     NOT NULL,
        "eventType"      VARCHAR                  NOT NULL,
        "payload"        TEXT                     NOT NULL,
        "success"        BOOLEAN                  NOT NULL DEFAULT false,
        "statusCode"     INTEGER,
        "errorMessage"   TEXT,
        "attempt"        INTEGER                  NOT NULL DEFAULT 1,
        "createdAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhook_delivery_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_webhook_log_sub"     ON "webhook_delivery_logs" ("subscriptionId");
      CREATE INDEX "IDX_webhook_log_success" ON "webhook_delivery_logs" ("success");
      CREATE INDEX "IDX_webhook_log_created" ON "webhook_delivery_logs" ("createdAt");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_delivery_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_subscriptions"`);
  }
}
