import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Call } from './call.entity';
import { ReportReason } from '../dto/report-call.dto';

@Entity('call_reports')
@Unique(['callId', 'reporterAddress'])
export class CallReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  callId: string;

  @Column({ type: 'varchar', length: 42 })
  reporterAddress: string;

  @Column({ type: 'enum', enum: ReportReason, nullable: true })
  reason: ReportReason | null;

  @ManyToOne(() => Call, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'callId' })
  call: Call;

  @CreateDateColumn()
  createdAt: Date;
}
