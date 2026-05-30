import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreatePayoutClaimsTable1760000002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'payout_claims',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'callId', type: 'uuid' },
          { name: 'stakerAddress', type: 'varchar', length: '56' },
          {
            name: 'amount',
            type: 'decimal',
            precision: 20,
            scale: 7,
            default: '0',
          },
          { name: 'txHash', type: 'varchar', length: '128', isNullable: true },
          { name: 'claimedAt', type: 'timestamp', isNullable: true },
          {
            name: 'status',
            type: 'varchar',
            default: `'PENDING'`,
          },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'payout_claims',
      new TableIndex({
        name: 'IDX_payout_claims_call_staker_unique',
        columnNames: ['callId', 'stakerAddress'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('payout_claims', 'IDX_payout_claims_call_staker_unique');
    await queryRunner.dropTable('payout_claims', true);
  }
}
