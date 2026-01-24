import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { OracleCall } from './oracle-call.entity';

@Entity('oracle_outcomes')
export class OracleOutcome {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => OracleCall, (call) => call.outcomes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'callId' })
  call: OracleCall;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  price: number;

  @Column({ type: 'varchar', length: 10 })
  outcome: 'YES' | 'NO';

  @Column({ type: 'text' })
  signature: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  transactionHash: string;

  @CreateDateColumn()
  createdAt: Date;
}
