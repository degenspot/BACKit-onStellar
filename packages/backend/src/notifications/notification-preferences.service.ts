import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationPreference } from './notification-preference.entity';
import { NotificationType } from './notification-type.enum';
import { NotificationChannel } from './notification-channel.enum';
import { UpdatePreferenceItemDto } from './dto/update-preference-item.dto';

export const SUPPORTED_TYPES = [
  NotificationType.CALL_RESOLVED,
  NotificationType.STAKE_UPDATE,
  NotificationType.NEW_FOLLOWER,
  NotificationType.PAYOUT_READY,
];

export const CHANNELS = [
  NotificationChannel.IN_APP,
  NotificationChannel.EMAIL,
  NotificationChannel.WEBHOOK,
];

@Injectable()
export class NotificationPreferencesService {
  private readonly logger = new Logger(NotificationPreferencesService.name);

  constructor(
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepository: Repository<NotificationPreference>,
  ) {}

  async initializePreferences(
    userAddress: string,
  ): Promise<NotificationPreference[]> {
    const existing = await this.preferenceRepository.find({
      where: { userAddress },
    });

    const toCreate: Partial<NotificationPreference>[] = [];

    for (const type of SUPPORTED_TYPES) {
      for (const channel of CHANNELS) {
        const found = existing.find(
          (p) => p.notificationType === type && p.channel === channel,
        );
        if (!found) {
          toCreate.push({
            userAddress,
            notificationType: type,
            channel,
            enabled: channel === NotificationChannel.IN_APP,
          });
        }
      }
    }

    if (toCreate.length > 0) {
      const created = this.preferenceRepository.create(toCreate);
      await this.preferenceRepository.save(created);
      this.logger.log(
        `Initialized ${toCreate.length} notification preferences for ${userAddress}`,
      );
      // Fetch everything again to return the full list
      return this.preferenceRepository.find({
        where: { userAddress },
      });
    }

    return existing;
  }

  async getPreferences(userAddress: string): Promise<NotificationPreference[]> {
    // Lazily initialize preferences if they don't exist or are incomplete
    return this.initializePreferences(userAddress);
  }

  async updatePreferences(
    userAddress: string,
    updates: UpdatePreferenceItemDto[],
  ): Promise<NotificationPreference[]> {
    // First, ensure preferences are initialized
    await this.initializePreferences(userAddress);

    for (const update of updates) {
      await this.preferenceRepository.update(
        {
          userAddress,
          notificationType: update.notificationType,
          channel: update.channel,
        },
        { enabled: update.enabled },
      );
    }

    return this.preferenceRepository.find({
      where: { userAddress },
    });
  }

  async checkPreference(
    userAddress: string,
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<boolean> {
    // If notification type is not one of the configurable ones, default to true for IN_APP, false for others
    if (!SUPPORTED_TYPES.includes(type)) {
      return channel === NotificationChannel.IN_APP;
    }

    const preference = await this.preferenceRepository.findOne({
      where: { userAddress, notificationType: type, channel },
    });

    // If not found, lazily initialize and check again, or default to true for IN_APP
    if (!preference) {
      await this.initializePreferences(userAddress);
      const reCheck = await this.preferenceRepository.findOne({
        where: { userAddress, notificationType: type, channel },
      });
      return reCheck ? reCheck.enabled : channel === NotificationChannel.IN_APP;
    }

    return preference.enabled;
  }
}
