import { Entity, Column, PrimaryGeneratedColumn, Index, Unique } from 'typeorm';
import { NotificationType } from './notification-type.enum';
import { NotificationChannel } from './notification-channel.enum';

@Entity('notification_preferences')
@Unique(['userAddress', 'notificationType', 'channel'])
export class NotificationPreference {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  userAddress: string;

  @Column({ type: 'varchar', length: 50 })
  notificationType: NotificationType;

  @Column({
    type: 'enum',
    enum: NotificationChannel,
  })
  channel: NotificationChannel;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;
}
