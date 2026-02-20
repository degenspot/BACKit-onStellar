import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, UpdateResult } from 'typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationEntity } from './notification.entity';
import { NotificationType } from './notification-type.enum';

const mockNotification: NotificationEntity = {
    id: 1,
    userId: 'user_abc',
    type: NotificationType.BACKED_CALL,
    referenceId: '42',
    message: 'Someone backed your call',
    readStatus: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
};

describe('NotificationsService', () => {
    let service: NotificationsService;
    let repo: jest.Mocked<Repository<NotificationEntity>>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                NotificationsService,
                {
                    provide: getRepositoryToken(NotificationEntity),
                    useValue: {
                        create: jest.fn(),
                        save: jest.fn(),
                        findAndCount: jest.fn(),
                        count: jest.fn(),
                        update: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<NotificationsService>(NotificationsService);
        repo = module.get(getRepositoryToken(NotificationEntity));
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('createNotification', () => {
        it('should create and save a notification', async () => {
            repo.create.mockReturnValue(mockNotification);
            repo.save.mockResolvedValue(mockNotification);

            const result = await service.createNotification(
                'user_abc',
                NotificationType.BACKED_CALL,
                'Someone backed your call',
                '42',
            );

            expect(repo.create).toHaveBeenCalledWith({
                userId: 'user_abc',
                type: NotificationType.BACKED_CALL,
                message: 'Someone backed your call',
                referenceId: '42',
                readStatus: false,
            });
            expect(repo.save).toHaveBeenCalledWith(mockNotification);
            expect(result).toEqual(mockNotification);
        });
    });

    describe('getNotifications', () => {
        it('should return paginated results with unreadCount', async () => {
            repo.findAndCount.mockResolvedValue([[mockNotification], 1]);
            repo.count.mockResolvedValue(1);

            const result = await service.getNotifications('user_abc', 20, 0);

            expect(result.data).toHaveLength(1);
            expect(result.totalCount).toBe(1);
            expect(result.hasNext).toBe(false);
            expect(result.unreadCount).toBe(1);
        });

        it('should indicate hasNext when more items exist', async () => {
            // Return limit+1 items to simulate more pages
            const items = Array(21).fill(mockNotification);
            repo.findAndCount.mockResolvedValue([items, 25]);
            repo.count.mockResolvedValue(5);

            const result = await service.getNotifications('user_abc', 20, 0);

            expect(result.hasNext).toBe(true);
            expect(result.data).toHaveLength(20);
        });
    });

    describe('markRead', () => {
        it('should update readStatus for given IDs', async () => {
            const updateResult: UpdateResult = { affected: 1, raw: [], generatedMaps: [] };
            repo.update.mockResolvedValue(updateResult);

            const result = await service.markRead('user_abc', [1]);

            expect(repo.update).toHaveBeenCalled();
            expect(result.updated).toBe(1);
        });

        it('should mark all unread if no IDs provided', async () => {
            const updateResult: UpdateResult = { affected: 3, raw: [], generatedMaps: [] };
            repo.update.mockResolvedValue(updateResult);

            const result = await service.markRead('user_abc');

            expect(result.updated).toBe(3);
        });
    });

    describe('notify convenience methods', () => {
        beforeEach(() => {
            repo.create.mockReturnValue(mockNotification);
            repo.save.mockResolvedValue(mockNotification);
        });

        it('notifyBackedCall should create BACKED_CALL notification', async () => {
            await service.notifyBackedCall('creator', 'backer123456789', 42);
            expect(repo.save).toHaveBeenCalled();
        });

        it('notifyCallEnded should create CALL_ENDED notification', async () => {
            await service.notifyCallEnded('user_abc', 42);
            expect(repo.save).toHaveBeenCalled();
        });

        it('notifyPayoutReady should create PAYOUT_READY notification', async () => {
            await service.notifyPayoutReady('user_abc', 42);
            expect(repo.save).toHaveBeenCalled();
        });

        it('notifyNewFollower should create NEW_FOLLOWER notification', async () => {
            await service.notifyNewFollower('user_abc', 'follower123456');
            expect(repo.save).toHaveBeenCalled();
        });
    });
});
