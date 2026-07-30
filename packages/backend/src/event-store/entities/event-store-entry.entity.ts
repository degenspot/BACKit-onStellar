import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Generated,
} from 'typeorm';

export enum AggregateType {
  CALL = 'CALL',
  USER = 'USER',
  STAKE = 'STAKE',
  PAYOUT = 'PAYOUT',
  ORACLE = 'ORACLE',
  ADMIN = 'ADMIN',
}

/**
 * Domain event names. Matches the EventEmitter2 event names emitted
 * elsewhere in the app (e.g. `this.eventEmitter.emit('call.created', ...)`),
 * so a listener can subscribe with `@OnEvent(DomainEventType.CALL_CREATED)`.
 */
export enum DomainEventType {
  CALL_CREATED = 'call.created',
  CALL_RESOLVED = 'call.resolved',
  STAKE_PLACED = 'stake.placed',
  STAKE_WITHDRAWN = 'stake.withdrawn',
  PAYOUT_CLAIMED = 'payout.claimed',
  USER_REGISTERED = 'user.registered',
  USER_FOLLOWED = 'user.followed',
  ADMIN_ACTION = 'admin.action',
  ORACLE_SUBMITTED = 'oracle.submitted',
}

export interface EventMetadata {
  correlationId: string;
  userAddress?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  [key: string]: unknown;
}

/**
 * Append-only event store row. Immutability is enforced both at the
 * application layer (no update/remove methods on EventStoreService) and at
 * the database layer (BEFORE UPDATE/DELETE triggers added in the migration).
 */
@Entity('event_store')
@Index(['aggregateType', 'aggregateId', 'sequence'])
export class EventStoreEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Global, gapless, monotonically increasing ordering key (Postgres
   * bigserial). This — not `createdAt`, which can collide at millisecond
   * resolution — is what guarantees replay ordering.
   */
  @Column({ type: 'bigint', update: false })
  @Generated('increment')
  @Index({ unique: true })
  sequence: string;

  @Column({ type: 'enum', enum: AggregateType, update: false })
  @Index()
  aggregateType: AggregateType;

  @Column({ type: 'varchar', length: 128, update: false })
  aggregateId: string;

  @Column({ type: 'enum', enum: DomainEventType, update: false })
  eventType: DomainEventType;

  /** Event payload — the data describing what happened. */
  @Column({ type: 'jsonb', update: false })
  payload: Record<string, unknown>;

  /** correlation_id, user_address, ip, user_agent, etc. */
  @Column({ type: 'jsonb', nullable: true, update: false })
  metadata: EventMetadata | null;

  /**
   * The Stellar ledger sequence this event corresponds to, when it is the
   * backend-side record of an on-chain action. Null for purely off-chain
   * events (e.g. a user follow).
   */
  @Column({ type: 'bigint', nullable: true, update: false })
  ledgerSequence: string | null;

  @CreateDateColumn({ type: 'timestamptz', update: false })
  @Index()
  createdAt: Date;
}
