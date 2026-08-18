import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WebhookEventType } from './webhook-event-type.enum';

@Entity('webhook_subscriptions')
@Index('IDX_webhook_sub_user', ['userAddress'])
@Index('IDX_webhook_sub_active', ['isActive'])
export class WebhookSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stellar wallet address of the subscriber */
  @Column()
  userAddress: string;

  /** The target URL that will receive POST payloads */
  @Column({ type: 'text' })
  url: string;

  /** HMAC-SHA256 signing secret — never returned in API responses */
  @Column({ type: 'text' })
  secret: string;

  /** Array of subscribed event types stored as jsonb */
  @Column({ type: 'simple-array' })
  events: WebhookEventType[];

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('webhook_delivery_logs')
@Index('IDX_webhook_log_sub', ['subscriptionId'])
@Index('IDX_webhook_log_success', ['success'])
@Index('IDX_webhook_log_created', ['createdAt'])
export class WebhookDeliveryLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  subscriptionId: string;

  @Column()
  eventType: string;

  @Column({ type: 'text' })
  payload: string;

  @Column({ default: false })
  success: boolean;

  @Column({ type: 'int', nullable: true })
  statusCode: number | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  /** BullMQ attempt number for this delivery */
  @Column({ type: 'int', default: 1 })
  attempt: number;

  @CreateDateColumn()
  createdAt: Date;
}
