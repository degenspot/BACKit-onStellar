import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { OracleOutcome } from './oracle-outcome.entity';

export enum OracleCallStatus {
  DRAFT        = 'DRAFT',
  OPEN         = 'OPEN',
  PAUSED       = 'PAUSED',        // circuit-breaker state — oracle blocked
  SETTLING     = 'SETTLING',
  RESOLVED_YES = 'RESOLVED_YES',
  RESOLVED_NO  = 'RESOLVED_NO',
}

@Entity('oracle_calls')
export class OracleCall {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 64 })
  pairAddress: string;

  @Column({ type: 'varchar', length: 32 })
  baseToken: string;

  @Column({ type: 'varchar', length: 32 })
  quoteToken: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  strikePrice: number;

  @Column({ type: 'timestamp' })
  callTime: Date;

  // ── circuit-breaker fields ───────────────────────────────────────────────
  @Column({
    type: 'enum',
    enum: OracleCallStatus,
    default: OracleCallStatus.DRAFT,
  })
  status: OracleCallStatus;

  @Column({ type: 'int', default: 0 })
  reportCount: number;

  @Column({ type: 'boolean', default: false })
  isHidden: boolean;
  // ────────────────────────────────────────────────────────────────────────

  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  failedAt: Date | null;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  finalPrice: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date | null;

  @OneToMany(() => OracleOutcome, (outcome) => outcome.call)
  outcomes: OracleOutcome[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}