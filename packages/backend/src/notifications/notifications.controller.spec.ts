import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './notification-type.enum';
import { NotificationEntity } from './notification.entity';

const mockNotification: NotificationEntity = {
    id: 1,
    userId: 'user_abc',
    type: NotificationType.BACKED_CALL,
    referenceId: '42',
    message: 'Someone backed your call',
    readStatus: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
};

describe('NotificationsController', () => {
    let controller: NotificationsController;
    let service: jest.Mocked<NotificationsService>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [NotificationsController],
            providers: [
                {
                    provide: NotificationsService,
                    useValue: {
                        getNotifications: jest.fn(),
                        markRead: jest.fn(),
                    },
                },
            ],
        }).compile();

        controller = module.get<NotificationsController>(NotificationsController);
        service = module.get(NotificationsService);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('getNotifications', () => {
        it('should return paginated notifications', async () => {
            const mockResult = {
                data: [mockNotification],
                totalCount: 1,
                hasNext: false,
                unreadCount: 1,
            };
            service.getNotifications.mockResolvedValue(mockResult);

            const result = await controller.getNotifications({
                userId: 'user_abc',
                limit: 20,
                offset: 0,
            });

            expect(service.getNotifications).toHaveBeenCalledWith('user_abc', 20, 0);
            expect(result).toEqual(mockResult);
        });
    });

    describe('markRead', () => {
        it('should mark given IDs as read', async () => {
            service.markRead.mockResolvedValue({ updated: 1 });

            const result = await controller.markRead('user_abc', { ids: [1] });

            expect(service.markRead).toHaveBeenCalledWith('user_abc', [1]);
            expect(result).toEqual({ updated: 1 });
        });

        it('should mark all as read when no ids provided', async () => {
            service.markRead.mockResolvedValue({ updated: 5 });

            const result = await controller.markRead('user_abc', {});

            expect(service.markRead).toHaveBeenCalledWith('user_abc', undefined);
            expect(result).toEqual({ updated: 5 });
        });
    });
});
