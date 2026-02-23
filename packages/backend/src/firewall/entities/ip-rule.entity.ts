import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum IpRuleType {
  WHITELIST = 'WHITELIST',
  BLACKLIST = 'BLACKLIST',
}

/**
 * IpRule stores admin-managed IP address rules.
 *
 * Supports:
 *  - Single IPv4 / IPv6 addresses  → cidr: "203.0.113.42"
 *  - CIDR ranges                   → cidr: "203.0.113.0/24"
 *  - Single-address CIDR notation  → cidr: "10.0.0.1/32"
 *
 * Evaluation order: WHITELIST beats BLACKLIST.
 * If an IP matches a whitelist rule it is always allowed, even if it also
 * matches a blacklist rule.
 */
@Entity('ip_rules')
export class IpRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** IPv4/IPv6 address or CIDR range, e.g. "192.168.1.0/24" or "::1". */
  @Column({ type: 'varchar', length: 64, unique: true })
  @Index()
  cidr: string;

  @Column({ type: 'enum', enum: IpRuleType })
  @Index()
  type: IpRuleType;

  /** Human-readable reason for adding this rule. */
  @Column({ type: 'text', nullable: true })
  reason: string | null;

  /** The admin who created the rule. */
  @Column({ type: 'varchar', length: 256, nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}