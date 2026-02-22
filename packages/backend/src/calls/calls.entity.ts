import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CallStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  RESOLVED_YES = 'RESOLVED_YES',
  RESOLVED_NO = 'RESOLVED_NO',
  SETTLING = 'SETTLING',
}

@Entity('calls')
export class CallEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  thesis: string;

  @Column({ type: 'varchar', length: 64 })
  tokenAddress: string;

  @Column({ type: 'varchar', length: 64 })
  pairId: string;

  @Column({ type: 'varchar', length: 64 })
  stakeToken: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  stakeAmount: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ipfsCid?: string;

  @Column({ type: 'varchar', length: 64 })
  creatorAddress: string;

  @Column({ type: 'timestamp' })
  endTs: Date;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt?: Date;

  @Column({
    type: 'enum',
    enum: CallStatus,
    default: CallStatus.DRAFT,
  })
  status: CallStatus;

  @Column({ type: 'boolean', default: false })
  settled: boolean;

  @Column({ type: 'json', nullable: true })
  conditionJson?: any;

  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  finalPrice?: string;

  @Column({ type: 'tsvector', nullable: true })
  searchVector: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
