import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type DeliveryStatus = 'success' | 'failed';

@Entity('webhook_delivery_logs')
export class WebhookDeliveryLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid' })
  @Index()
  subscriptionId: string;

  @Column({ type: 'varchar', length: 64 })
  eventType: string;

  @Column({ type: 'varchar', length: 2048 })
  targetUrl: string;

  @Column({ type: 'varchar', length: 20, default: 'success' })
  @Index()
  status: DeliveryStatus;

  @Column({ type: 'int', default: 1 })
  attemptNumber: number;

  @Column({ type: 'int', default: 200 })
  httpStatus: number;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string | null;

  @Column({ type: 'bigint', default: 0 })
  durationMs: number;

  @CreateDateColumn()
  createdAt: Date;
}
