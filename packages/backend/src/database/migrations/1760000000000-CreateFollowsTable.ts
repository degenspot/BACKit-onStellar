import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateFollowsTable1760000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'follows',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'followerAddress', type: 'varchar', length: '64' },
          { name: 'followingAddress', type: 'varchar', length: '64' },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'follows',
      new TableIndex({
        name: 'IDX_follows_followerAddress',
        columnNames: ['followerAddress'],
      }),
    );

    await queryRunner.createIndex(
      'follows',
      new TableIndex({
        name: 'IDX_follows_followingAddress',
        columnNames: ['followingAddress'],
      }),
    );

    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_follows_follower_following" ON "follows" ("followerAddress", "followingAddress")',
    );

    await queryRunner.createForeignKey(
      'follows',
      new TableForeignKey({
        columnNames: ['followerAddress'],
        referencedTableName: 'users',
        referencedColumnNames: ['walletAddress'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'follows',
      new TableForeignKey({
        columnNames: ['followingAddress'],
        referencedTableName: 'users',
        referencedColumnNames: ['walletAddress'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_follows_follower_following"',
    );
    await queryRunner.dropIndex('follows', 'IDX_follows_followerAddress');
    await queryRunner.dropIndex('follows', 'IDX_follows_followingAddress');
    await queryRunner.dropTable('follows', true);
  }
}
