import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    CreateDateColumn,
    Index,
} from 'typeorm';
import { NotificationType } from './notification-type.enum';

@Entity('notifications')
export class NotificationEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 64 })
    @Index()
    userId: string;

    @Column({ type: 'varchar', length: 50 })
    type: NotificationType;

    @Column({ type: 'varchar', length: 64, nullable: true })
    referenceId?: string;

    @Column({ type: 'varchar', length: 255 })
    message: string;

    @Column({ type: 'boolean', default: false })
    @Index()
    readStatus: boolean;

    @CreateDateColumn()
    @Index()
    createdAt: Date;
}
