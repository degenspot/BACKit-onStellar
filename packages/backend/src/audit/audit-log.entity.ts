import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum AuditStatus {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

export enum AuditActionType {
  // Oracle parameter changes
  ORACLE_PARAMS_UPDATED = 'ORACLE_PARAMS_UPDATED',
  ORACLE_QUORUM_SET = 'ORACLE_QUORUM_SET',

  // Market resolution
  MARKET_MANUALLY_RESOLVED = 'MARKET_MANUALLY_RESOLVED',
  MARKET_DISPUTED = 'MARKET_DISPUTED',
  MARKET_PAUSED = 'MARKET_PAUSED',

  // Generic admin actions (extend as needed)
  ADMIN_ACTION = 'ADMIN_ACTION',
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * When the action occurred. Set automatically by the DB; cannot be altered
   * by application code — keeping the log immutable.
   */
  @CreateDateColumn({ type: 'timestamptz', update: false })
  @Index()
  timestamp: Date;

  /**
   * The authenticated user who triggered the action.
   * Stored as an opaque string so it can hold a wallet address, UUID, or email.
   */
  @Column({ type: 'varchar', length: 256, update: false })
  @Index()
  actorId: string;

  /** Human-readable label pulled from the enum above. */
  @Column({ type: 'enum', enum: AuditActionType, update: false })
  @Index()
  actionType: AuditActionType;

  /**
   * The resource being acted upon, e.g. "market:abc123" or "oracle:feed:XLM/USD".
   * Free-form so it stays flexible across feature areas.
   */
  @Column({ type: 'varchar', length: 512, update: false })
  targetResource: string;

  /**
   * A JSON snapshot of the request body / relevant parameters at the time of
   * the call. Stored as jsonb for efficient querying in Postgres.
   */
  @Column({ type: 'jsonb', nullable: true, update: false })
  requestPayload: Record<string, unknown> | null;

  /**
   * A JSON snapshot of the response returned to the caller (or the error).
   */
  @Column({ type: 'jsonb', nullable: true, update: false })
  responsePayload: Record<string, unknown> | null;

  /** HTTP status code returned to the caller. */
  @Column({ type: 'int', update: false })
  httpStatus: number;

  /** Whether the admin action ultimately succeeded or failed. */
  @Column({ type: 'enum', enum: AuditStatus, update: false })
  status: AuditStatus;

  /** Optional free-text note, e.g. reason for manual resolution. */
  @Column({ type: 'text', nullable: true, update: false })
  note: string | null;
}