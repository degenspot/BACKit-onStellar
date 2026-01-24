import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { OracleOutcome } from './oracle-outcome.entity';

@Entity('oracle_calls')
export class OracleCall {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  pairAddress: string;

  @Column({ type: 'varchar', length: 255 })
  baseToken: string;

  @Column({ type: 'varchar', length: 255 })
  quoteToken: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  strikePrice: number;

  @Column({ type: 'timestamp' })
  callTime: Date;

  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  failedAt: Date;

  @Column({ type: 'text', nullable: true })
  failureReason: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => OracleOutcome, (outcome) => outcome.call)
  outcomes: OracleOutcome[];
}
