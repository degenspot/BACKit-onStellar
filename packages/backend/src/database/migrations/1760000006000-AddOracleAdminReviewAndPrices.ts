import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddOracleAdminReviewAndPrices1760000006000 implements MigrationInterface {
  public name = 'AddOracleAdminReviewAndPrices1760000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'oracle_calls',
      new TableColumn({
        name: 'needsAdminReview',
        type: 'boolean',
        default: false,
      }),
    );

    await queryRunner.addColumns('oracle_health_logs', [
      new TableColumn({
        name: 'dexScreenerPrice',
        type: 'decimal',
        precision: 20,
        scale: 8,
        isNullable: true,
      }),
      new TableColumn({
        name: 'horizonPrice',
        type: 'decimal',
        precision: 20,
        scale: 8,
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('oracle_calls', 'needsAdminReview');
    await queryRunner.dropColumns('oracle_health_logs', [
      'dexScreenerPrice',
      'horizonPrice',
    ]);
  }
}
