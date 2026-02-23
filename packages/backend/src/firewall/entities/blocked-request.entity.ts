import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum BlockReason {
  BLACKLISTED_IP = 'BLACKLISTED_IP',
  BOT_FINGERPRINT = 'BOT_FINGERPRINT',
  TURNSTILE_FAILED = 'TURNSTILE_FAILED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  MALFORMED_REQUEST = 'MALFORMED_REQUEST',
}

/**
 * Every dropped request produces one immutable BlockedRequest row.
 * These feed the security audit trail and can be queried via
 * GET /admin/firewall/blocked-requests.
 *
 * Error code format: BACKIT-FW-<YYYYMMDD>-<6-char hex>
 * Example: BACKIT-FW-20240315-a3f9c1
 */
@Entity('blocked_requests')
export class BlockedRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Unique, human-readable error code surfaced to the caller and stored here.
   * Makes cross-referencing logs trivial for support/security teams.
   */
  @Column({ type: 'varchar', length: 64, unique: true, update: false })
  @Index()
  errorCode: string;

  @Column({ type: 'varchar', length: 64, update: false })
  @Index()
  ip: string;

  @Column({ type: 'enum', enum: BlockReason, update: false })
  @Index()
  reason: BlockReason;

  /** HTTP method of the blocked request. */
  @Column({ type: 'varchar', length: 16, update: false })
  method: string;

  /** Request path (without query string). */
  @Column({ type: 'varchar', length: 1024, update: false })
  path: string;

  /** Captured User-Agent string for bot fingerprinting post-analysis. */
  @Column({ type: 'text', nullable: true, update: false })
  userAgent: string | null;

  /** Subset of request headers useful for forensics (no auth headers). */
  @Column({ type: 'jsonb', nullable: true, update: false })
  headers: Record<string, string> | null;

  @CreateDateColumn({ type: 'timestamptz', update: false })
  @Index()
  blockedAt: Date;
}