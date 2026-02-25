import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
  CreateDateColumn,
} from 'typeorm';

/**
 * Singleton row — always id = 1.
 * All platform-wide settings that mirror the Soroban contract live here.
 * Never insert more than one row; use ConfigService.getSettings() to read
 * and ConfigService.applyAdminParamsChanged() to write.
 */
@Entity('platform_settings')
export class PlatformSettings {
  // Fixed primary key enforces the singleton pattern at the DB level
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number;

  // ─── fee ──────────────────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 1.0 })
  feePercent: number;

  // ─── contract addresses ───────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 56, nullable: true })
  contractId: string | null;

  // ─── oracle settings ──────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 56, nullable: true })
  oracleContractId: string | null;

  // ─── audit trail ─────────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 100, nullable: true })
  lastUpdatedByTxHash: string | null;

  @Column({ type: 'bigint', nullable: true })
  lastUpdatedAtLedger: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}