import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum EventType {
  CALL_CREATED = 'call_created',
  STAKE_ADDED = 'stake_added',
  CALL_RESOLVED = 'call_resolved',
  CALL_SETTLED = 'call_settled',
  ADMIN_CHANGED = 'admin_changed',  
  ADMIN_PARAMS_CHANGED    = 'admin_params_changed',  
  OUTCOME_MANAGER_CHANGED = 'outcome_manager_changed',
  OUTCOME_FINALIZED = 'outcome_finalized',
  INITIALIZED = 'initialized',
  ADMIN_PARAMS_CHANGED = 'admin_params_changed',
}

@Entity('event_logs')
export class EventLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Index()
  eventId: string;

  @Column()
  pagingToken: string;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  contractId: string;

  @Column({ type: 'varchar', length: 50 })
  @Index()
  eventType: EventType;

  @Column({ type: 'bigint' })
  @Index()
  ledger: number;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  txHash: string;

  @Column({ type: 'integer' })
  txOrder: number;

  @Column({ type: 'jsonb' })
  eventData: any;

  @Column({ type: 'timestamp' })
  @Index()
  timestamp: Date;

  @CreateDateColumn()
  createdAt: Date;
}
