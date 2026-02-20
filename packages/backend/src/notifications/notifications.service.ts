import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { NotificationEntity } from './notification.entity';
import { NotificationType } from './notification-type.enum';

export interface PaginatedNotifications {
    data: NotificationEntity[];
    totalCount: number;
    hasNext: boolean;
    unreadCount: number;
}

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(
        @InjectRepository(NotificationEntity)
        private readonly notificationsRepository: Repository<NotificationEntity>,
    ) { }

    /**
     * Core dispatch method — currently in-app only.
     * To add Email/Push, extend this method with additional channels.
     */
    async notify(
        userId: string,
        type: NotificationType,
        message: string,
        referenceId?: string,
    ): Promise<NotificationEntity> {
        return this.createNotification(userId, type, message, referenceId);
    }

    async createNotification(
        userId: string,
        type: NotificationType,
        message: string,
        referenceId?: string,
    ): Promise<NotificationEntity> {
        const notification = this.notificationsRepository.create({
            userId,
            type,
            message,
            referenceId,
            readStatus: false,
        });

        const saved = await this.notificationsRepository.save(notification);
        this.logger.verbose(`Notification created: ${type} for user ${userId}`);
        return saved;
    }

    async getNotifications(
        userId: string,
        limit = 20,
        offset = 0,
    ): Promise<PaginatedNotifications> {
        const [data, totalCount] = await this.notificationsRepository.findAndCount({
            where: { userId },
            order: { createdAt: 'DESC' },
            skip: offset,
            take: limit + 1,
        });

        const hasNext = data.length > limit;
        const resultData = hasNext ? data.slice(0, limit) : data;

        const unreadCount = await this.notificationsRepository.count({
            where: { userId, readStatus: false },
        });

        return { data: resultData, totalCount, hasNext, unreadCount };
    }

    async markRead(userId: string, ids?: number[]): Promise<{ updated: number }> {
        if (ids && ids.length > 0) {
            const result = await this.notificationsRepository.update(
                { userId, id: In(ids) },
                { readStatus: true },
            );
            return { updated: result.affected ?? 0 };
        }

        // Mark all unread for this user if no IDs provided
        const result = await this.notificationsRepository.update(
            { userId, readStatus: false },
            { readStatus: true },
        );
        return { updated: result.affected ?? 0 };
    }

    // ── Convenience trigger methods ────────────────────────────────────────────

    async notifyBackedCall(
        callCreatorId: string,
        backerAddress: string,
        callId: number,
    ): Promise<void> {
        await this.notify(
            callCreatorId,
            NotificationType.BACKED_CALL,
            `${backerAddress.slice(0, 8)}... backed your call`,
            String(callId),
        );
    }

    async notifyCallEnded(userId: string, callId: number): Promise<void> {
        await this.notify(
            userId,
            NotificationType.CALL_ENDED,
            'A call you staked on has ended',
            String(callId),
        );
    }

    async notifyPayoutReady(userId: string, callId: number): Promise<void> {
        await this.notify(
            userId,
            NotificationType.PAYOUT_READY,
            'You won! Claim your payout',
            String(callId),
        );
    }

    async notifyNewFollower(userId: string, followerAddress: string): Promise<void> {
        await this.notify(
            userId,
            NotificationType.NEW_FOLLOWER,
            `${followerAddress.slice(0, 8)}... followed you`,
            followerAddress,
        );
    }
}
