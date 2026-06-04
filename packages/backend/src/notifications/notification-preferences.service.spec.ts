import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotificationPreferencesService,
  SUPPORTED_TYPES,
  CHANNELS,
} from './notification-preferences.service';
import { NotificationPreference } from './notification-preference.entity';
import { NotificationType } from './notification-type.enum';
import { NotificationChannel } from './notification-channel.enum';

describe('NotificationPreferencesService', () => {
  let service: NotificationPreferencesService;
  let repo: jest.Mocked<Repository<NotificationPreference>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPreferencesService,
        {
          provide: getRepositoryToken(NotificationPreference),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<NotificationPreferencesService>(
      NotificationPreferencesService,
    );
    repo = module.get(getRepositoryToken(NotificationPreference));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initializePreferences', () => {
    it('should create defaults if no preferences exist', async () => {
      repo.find.mockResolvedValueOnce([]); // First find returns empty
      repo.create.mockImplementation((items) => items as any);
      repo.save.mockResolvedValueOnce([] as any);
      repo.find.mockResolvedValueOnce([
        {
          id: 1,
          userAddress: 'user_addr',
          notificationType: NotificationType.NEW_FOLLOWER,
          channel: NotificationChannel.IN_APP,
          enabled: true,
        },
      ]);

      const result = await service.initializePreferences('user_addr');

      expect(repo.find).toHaveBeenCalledWith({
        where: { userAddress: 'user_addr' },
      });
      expect(repo.create).toHaveBeenCalled();
      const createdItems = repo.create.mock.calls[0][0] as any[];
      expect(createdItems).toHaveLength(12); // 4 types * 3 channels

      // Check one specific default
      const inAppFollower = createdItems.find(
        (p) =>
          p.notificationType === NotificationType.NEW_FOLLOWER &&
          p.channel === NotificationChannel.IN_APP,
      );
      expect(inAppFollower.enabled).toBe(true);

      const emailFollower = createdItems.find(
        (p) =>
          p.notificationType === NotificationType.NEW_FOLLOWER &&
          p.channel === NotificationChannel.EMAIL,
      );
      expect(emailFollower.enabled).toBe(false);

      expect(result).toHaveLength(1);
    });

    it('should not create anything if preferences already exist', async () => {
      const mockPrefs = SUPPORTED_TYPES.flatMap((type) =>
        CHANNELS.map((channel) => ({
          userAddress: 'user_addr',
          notificationType: type,
          channel,
          enabled: channel === NotificationChannel.IN_APP,
        })),
      );

      repo.find.mockResolvedValueOnce(mockPrefs as any);

      const result = await service.initializePreferences('user_addr');

      expect(repo.create).not.toHaveBeenCalled();
      expect(result).toHaveLength(12);
    });
  });

  describe('getPreferences', () => {
    it('should call initializePreferences', async () => {
      repo.find.mockResolvedValueOnce([]); // First find in init
      repo.create.mockImplementation((items) => items as any);
      repo.save.mockResolvedValueOnce([] as any);
      repo.find.mockResolvedValueOnce([]); // Second find in init

      await service.getPreferences('user_addr');
      expect(repo.find).toHaveBeenCalled();
    });
  });

  describe('updatePreferences', () => {
    it('should update preferences and return all preferences', async () => {
      repo.find.mockResolvedValueOnce([]); // init check
      repo.create.mockImplementation((items) => items as any);
      repo.save.mockResolvedValueOnce([] as any);
      repo.update.mockResolvedValue({} as any);
      const mockResult = [
        {
          userAddress: 'user_addr',
          notificationType: NotificationType.NEW_FOLLOWER,
          channel: NotificationChannel.EMAIL,
          enabled: true,
        },
      ];
      repo.find.mockResolvedValueOnce(mockResult as any); // second find (inside initializePreferences)
      repo.find.mockResolvedValueOnce(mockResult as any); // third find (final return)

      const updates = [
        {
          notificationType: NotificationType.NEW_FOLLOWER,
          channel: NotificationChannel.EMAIL,
          enabled: true,
        },
      ];

      const result = await service.updatePreferences('user_addr', updates);

      expect(repo.update).toHaveBeenCalledWith(
        {
          userAddress: 'user_addr',
          notificationType: NotificationType.NEW_FOLLOWER,
          channel: NotificationChannel.EMAIL,
        },
        { enabled: true },
      );
      expect(result[0].enabled).toBe(true);
    });
  });

  describe('checkPreference', () => {
    it('should return true for un-configurable types on IN_APP channel', async () => {
      const result = await service.checkPreference(
        'user_addr',
        NotificationType.BACKED_CALL,
        NotificationChannel.IN_APP,
      );
      expect(result).toBe(true);
    });

    it('should return false for un-configurable types on EMAIL channel', async () => {
      const result = await service.checkPreference(
        'user_addr',
        NotificationType.BACKED_CALL,
        NotificationChannel.EMAIL,
      );
      expect(result).toBe(false);
    });

    it('should return preference value if configured', async () => {
      repo.findOne.mockResolvedValueOnce({
        enabled: true,
      } as any);

      const result = await service.checkPreference(
        'user_addr',
        NotificationType.NEW_FOLLOWER,
        NotificationChannel.EMAIL,
      );

      expect(result).toBe(true);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: {
          userAddress: 'user_addr',
          notificationType: NotificationType.NEW_FOLLOWER,
          channel: NotificationChannel.EMAIL,
        },
      });
    });
  });
});
