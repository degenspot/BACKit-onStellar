import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CallStatus {
  DRAFT        = 'DRAFT',
  OPEN         = 'OPEN',
  PAUSED       = 'PAUSED',
  SETTLING     = 'SETTLING',
  RESOLVED_YES = 'RESOLVED_YES',
  RESOLVED_NO  = 'RESOLVED_NO',
}

@Entity('calls')
export class Call {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 42 })
  creatorAddress: string;

  // ─── circuit-breaker / moderation ────────────────────────────────────────

  @Column({ type: 'boolean', default: false })
  isHidden: boolean;

  @Column({ type: 'int', default: 0 })
  reportCount: number;

  @Column({
    type: 'enum',
    enum: CallStatus,
    default: CallStatus.DRAFT,
  })
  status: CallStatus;

  // ─── resolution ───────────────────────────────────────────────────────────

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  finalPrice: string | null;

  // ─── timestamps ───────────────────────────────────────────────────────────

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}