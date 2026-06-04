import { IsEnum, IsBoolean } from 'class-validator';
import { NotificationType } from '../notification-type.enum';
import { NotificationChannel } from '../notification-channel.enum';

export class UpdatePreferenceItemDto {
  @IsEnum(NotificationType)
  notificationType: NotificationType;

  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @IsBoolean()
  enabled: boolean;
}
