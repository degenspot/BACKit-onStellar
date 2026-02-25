import {
  Entity,
  Column,
  PrimaryColumn,
  UpdateDateColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('platform_settings')
export class PlatformSettings {
  @PrimaryColumn({ default: 1 })
  id: number;

  @Column({ type: 'integer', default: 0 })
  feePercent: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  lastUpdatedByTxHash: string;

  @Column({ type: 'bigint', nullable: true })
  lastUpdatedAtLedger: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
