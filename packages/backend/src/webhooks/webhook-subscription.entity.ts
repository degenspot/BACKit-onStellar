import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('webhook_subscriptions')
export class WebhookSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  userAddress: string;

  @Column({ type: 'varchar', length: 2048 })
  url: string;

  /** HMAC-SHA256 signing key used to sign outgoing payloads */
  @Column({ type: 'text' })
  secret: string;

  /** Array of event types this subscription listens to */
  @Column({ type: 'jsonb', default: [] })
  events: string[];

  @Column({ type: 'boolean', default: true })
  @Index()
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
