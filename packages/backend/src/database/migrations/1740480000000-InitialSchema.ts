import { MigrationInterface, QueryRunner, Table, TableCheck } from 'typeorm';

/**
 * Initial baseline migration — captures the full schema as it existed when
 * synchronize:true was disabled.  All subsequent changes must be expressed
 * as new migration files generated via `npm run typeorm:generate`.
 */
export class InitialSchema1740480000000 implements MigrationInterface {
  public name = 'InitialSchema1740480000000';

  // ─── UP ──────────────────────────────────────────────────────────────────────

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── users ──────────────────────────────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'wallet_address', type: 'varchar', length: '56', isUnique: true },
          { name: 'username', type: 'varchar', length: '64', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true, // skip if already exists
    );

    // ── stakes ─────────────────────────────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'stakes',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'user_id', type: 'uuid' },
          { name: 'contract_id', type: 'varchar', length: '56' },
          {
            name: 'amount',
            type: 'numeric',
            precision: 38,
            scale: 7,
            comment: 'Stellar stroops — must be >= 0 (enforced by CHECK constraint)',
          },
          {
            name: 'rewards_accrued',
            type: 'numeric',
            precision: 38,
            scale: 7,
            default: 0,
            comment: 'Unclaimed rewards — must be >= 0',
          },
          { name: 'staked_at', type: 'timestamptz', default: 'now()' },
          { name: 'unstaked_at', type: 'timestamptz', isNullable: true },
          { name: 'is_active', type: 'boolean', default: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
        foreignKeys: [
          {
            columnNames: ['user_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );

    // ── DB-level CHECK constraints (data integrity guardrails) ─────────────────
    await queryRunner.createCheckConstraint(
      'stakes',
      new TableCheck({
        name: 'CHK_stakes_amount_non_negative',
        columnNames: ['amount'],
        expression: '"amount" >= 0',
      }),
    );

    await queryRunner.createCheckConstraint(
      'stakes',
      new TableCheck({
        name: 'CHK_stakes_rewards_non_negative',
        columnNames: ['rewards_accrued'],
        expression: '"rewards_accrued" >= 0',
      }),
    );

    // ── pools ──────────────────────────────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'pools',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'contract_id', type: 'varchar', length: '56', isUnique: true },
          { name: 'name', type: 'varchar', length: '128' },
          {
            name: 'total_staked',
            type: 'numeric',
            precision: 38,
            scale: 7,
            default: 0,
          },
          {
            name: 'apy_bps',
            type: 'integer',
            comment: 'APY in basis points (100 = 1%). Must be >= 0.',
          },
          { name: 'is_active', type: 'boolean', default: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createCheckConstraint(
      'pools',
      new TableCheck({
        name: 'CHK_pools_total_staked_non_negative',
        columnNames: ['total_staked'],
        expression: '"total_staked" >= 0',
      }),
    );

    await queryRunner.createCheckConstraint(
      'pools',
      new TableCheck({
        name: 'CHK_pools_apy_non_negative',
        columnNames: ['apy_bps'],
        expression: '"apy_bps" >= 0',
      }),
    );

    // ── events (indexed blockchain events cache) ───────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'contract_events',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'contract_id', type: 'varchar', length: '56' },
          { name: 'ledger', type: 'integer' },
          { name: 'event_type', type: 'varchar', length: '64' },
          { name: 'payload', type: 'jsonb' },
          { name: 'tx_hash', type: 'varchar', length: '128', isNullable: true },
          { name: 'indexed_at', type: 'timestamptz', default: 'now()' },
        ],
        indices: [
          { columnNames: ['contract_id'] },
          { columnNames: ['ledger'] },
          { columnNames: ['event_type'] },
        ],
      }),
      true,
    );

    await queryRunner.createCheckConstraint(
      'contract_events',
      new TableCheck({
        name: 'CHK_contract_events_ledger_positive',
        columnNames: ['ledger'],
        expression: '"ledger" > 0',
      }),
    );

    // ── uuid extension (must exist before uuid_generate_v4 defaults work) ──────
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  }

  // ─── DOWN ─────────────────────────────────────────────────────────────────────

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('contract_events', true);
    await queryRunner.dropTable('stakes', true);
    await queryRunner.dropTable('pools', true);
    await queryRunner.dropTable('users', true);
  }
}
