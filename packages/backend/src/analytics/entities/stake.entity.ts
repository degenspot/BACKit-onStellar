import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Call } from './call.entity';

@Entity('stakes')
@Index(['userAddress', 'createdAt'])
@Index(['callId', 'userAddress'])
@Index(['userAddress', 'profitLoss'])
export class Stake {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  callId: string;

  @Column({ type: 'varchar', length: 56 })
  @Index()
  userAddress: string;

  @Column({ type: 'decimal', precision: 20, scale: 7 })
  amount: number;

  @Column({ type: 'enum', enum: ['YES', 'NO'] })
  position: 'YES' | 'NO';

  @Column({ type: 'decimal', precision: 20, scale: 7, nullable: true })
  profitLoss?: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  transactionHash?: string;

  @CreateDateColumn()
  @Index()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Call)
  @JoinColumn({ name: 'callId' })
  call: Call;
}
