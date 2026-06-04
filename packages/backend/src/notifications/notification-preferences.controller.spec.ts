import { Test, TestingModule } from '@nestjs/testing';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationType } from './notification-type.enum';
import { NotificationChannel } from './notification-channel.enum';

describe('NotificationPreferencesController', () => {
  let controller: NotificationPreferencesController;
  let service: jest.Mocked<NotificationPreferencesService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationPreferencesController],
      providers: [
        {
          provide: NotificationPreferencesService,
          useValue: {
            getPreferences: jest.fn(),
            updatePreferences: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<NotificationPreferencesController>(
      NotificationPreferencesController,
    );
    service = module.get(NotificationPreferencesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getPreferences', () => {
    it('should return preferences from the service', async () => {
      const mockResult = [
        {
          id: 1,
          userAddress: 'user_addr',
          notificationType: NotificationType.NEW_FOLLOWER,
          channel: NotificationChannel.IN_APP,
          enabled: true,
        },
      ];
      service.getPreferences.mockResolvedValue(mockResult);

      const result = await controller.getPreferences('user_addr');

      expect(service.getPreferences).toHaveBeenCalledWith('user_addr');
      expect(result).toEqual(mockResult);
    });
  });

  describe('updatePreferences', () => {
    it('should call updatePreferences on service and return result', async () => {
      const mockResult = [
        {
          id: 1,
          userAddress: 'user_addr',
          notificationType: NotificationType.NEW_FOLLOWER,
          channel: NotificationChannel.EMAIL,
          enabled: true,
        },
      ];
      service.updatePreferences.mockResolvedValue(mockResult);

      const body = {
        preferences: [
          {
            notificationType: NotificationType.NEW_FOLLOWER,
            channel: NotificationChannel.EMAIL,
            enabled: true,
          },
        ],
      };

      const result = await controller.updatePreferences('user_addr', body);

      expect(service.updatePreferences).toHaveBeenCalledWith(
        'user_addr',
        body.preferences,
      );
      expect(result).toEqual(mockResult);
    });
  });
});
