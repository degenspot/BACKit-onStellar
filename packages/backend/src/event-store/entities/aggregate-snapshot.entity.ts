import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { AggregateType } from './event-store-entry.entity';

/**
 * A point-in-time snapshot of an aggregate's replayed state, taken every N
 * events (see EventStoreService.SNAPSHOT_INTERVAL). Lets replayAggregate()
 * start from the latest snapshot instead of the beginning of the stream.
 */
@Entity('aggregate_snapshots')
@Index(['aggregateType', 'aggregateId', 'sequence'])
export class AggregateSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: AggregateType, update: false })
  aggregateType: AggregateType;

  @Column({ type: 'varchar', length: 128, update: false })
  aggregateId: string;

  /** The `sequence` of the last event folded into this snapshot's state. */
  @Column({ type: 'bigint', update: false })
  sequence: string;

  /** How many events (from the start of the aggregate's stream) this snapshot represents. */
  @Column({ type: 'int', update: false })
  version: number;

  @Column({ type: 'jsonb', update: false })
  state: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', update: false })
  createdAt: Date;
}
