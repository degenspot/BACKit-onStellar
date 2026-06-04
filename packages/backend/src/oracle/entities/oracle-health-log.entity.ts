import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum OracleOperationType {
  FETCH = 'fetch',
  SIGN = 'sign',
  SUBMIT = 'submit',
}

@Entity('oracle_health_logs')
export class OracleHealthLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  oracleKey: string;

  @Column({ type: 'text', nullable: true })
  callId: string | null;

  @Column({
    type: 'enum',
    enum: OracleOperationType,
  })
  operation: OracleOperationType;

  @Column({ type: 'timestamp' })
  submissionTime: Date;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  priceFetched: number | null;

  @Column({ default: false })
  success: boolean;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'int', default: 0 })
  latencyMs: number;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  expectedPrice: number | null;

  @Column('decimal', { precision: 10, scale: 4, nullable: true })
  deviationPercent: number | null;

  @Column({ default: false })
  deviationBreached: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
