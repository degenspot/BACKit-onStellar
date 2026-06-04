import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddTokenWhitelistFields1760000005000 implements MigrationInterface {
  public name = 'AddTokenWhitelistFields1760000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('tokens', [
      new TableColumn({
        name: 'isWhitelisted',
        type: 'boolean',
        default: false,
      }),
      new TableColumn({
        name: 'addedBy',
        type: 'varchar',
        length: '56',
        isNullable: true,
      }),
      new TableColumn({
        name: 'addedAt',
        type: 'timestamptz',
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('tokens', [
      'isWhitelisted',
      'addedBy',
      'addedAt',
    ]);
  }
}
