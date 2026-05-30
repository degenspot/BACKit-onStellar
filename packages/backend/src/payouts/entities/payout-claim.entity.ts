import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum PayoutClaimStatus {
  PENDING = 'PENDING',
  CLAIMED = 'CLAIMED',
  FAILED = 'FAILED',
}

@Entity('payout_claims')
@Index(['callId', 'stakerAddress'], { unique: true })
export class PayoutClaim {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  callId: string;

  @Column({ type: 'varchar', length: 56 })
  @Index()
  stakerAddress: string;

  @Column({ type: 'decimal', precision: 20, scale: 7, default: 0 })
  amount: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  txHash: string | null;

  @Column({ type: 'timestamp', nullable: true })
  claimedAt: Date | null;

  @Column({
    type: 'enum',
    enum: PayoutClaimStatus,
    default: PayoutClaimStatus.PENDING,
  })
  status: PayoutClaimStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
