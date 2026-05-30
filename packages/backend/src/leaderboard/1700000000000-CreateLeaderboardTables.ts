import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateLeaderboardTables1700000000000 implements MigrationInterface {
  name = 'CreateLeaderboardTables1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'prediction_calls',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid', isNullable: false },
          {
            name: 'status',
            type: 'enum',
            enum: ['pending', 'settled', 'cancelled'],
            default: "'pending'",
          },
          {
            name: 'outcome',
            type: 'enum',
            enum: ['won', 'lost'],
            isNullable: true,
          },
          {
            name: 'profitUsdc',
            type: 'decimal',
            precision: 18,
            scale: 6,
            default: 0,
          },
          {
            name: 'stakeUsdc',
            type: 'decimal',
            precision: 18,
            scale: 6,
            default: 0,
          },
          { name: 'settledAt', type: 'timestamp', isNullable: true },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'leaderboard_snapshots',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid', isNullable: false },
          { name: 'username', type: 'varchar', isNullable: false },
          { name: 'avatarUrl', type: 'varchar', isNullable: true },
          { name: 'totalCalls', type: 'int', default: 0 },
          { name: 'wonCalls', type: 'int', default: 0 },
          { name: 'lostCalls', type: 'int', default: 0 },
          {
            name: 'winRate',
            type: 'decimal',
            precision: 10,
            scale: 4,
            default: 0,
          },
          {
            name: 'totalProfit',
            type: 'decimal',
            precision: 18,
            scale: 6,
            default: 0,
          },
          { name: 'rank', type: 'int', default: 0 },
          { name: 'period', type: 'varchar', default: "'all'" },
          { name: 'snapshotDate', type: 'date', isNullable: false },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Composite indexes for efficient leaderboard queries
    await queryRunner.createIndex(
      'prediction_calls',
      new TableIndex({
        columnNames: ['userId', 'status'],
        name: 'IDX_calls_userId_status',
      }),
    );
    await queryRunner.createIndex(
      'prediction_calls',
      new TableIndex({
        columnNames: ['status', 'settledAt'],
        name: 'IDX_calls_status_settledAt',
      }),
    );
    await queryRunner.createIndex(
      'prediction_calls',
      new TableIndex({
        columnNames: ['status', 'outcome'],
        name: 'IDX_calls_status_outcome',
      }),
    );
    await queryRunner.createIndex(
      'prediction_calls',
      new TableIndex({ columnNames: ['userId'], name: 'IDX_calls_userId' }),
    );
    await queryRunner.createIndex(
      'leaderboard_snapshots',
      new TableIndex({
        columnNames: ['period', 'snapshotDate'],
        name: 'IDX_snapshot_period_date',
      }),
    );
    await queryRunner.createIndex(
      'leaderboard_snapshots',
      new TableIndex({ columnNames: ['userId'], name: 'IDX_snapshot_userId' }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('leaderboard_snapshots', true);
    await queryRunner.dropTable('prediction_calls', true);
  }
}
