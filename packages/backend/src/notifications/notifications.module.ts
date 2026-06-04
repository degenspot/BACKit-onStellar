import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationEntity } from './notification.entity';
import { NotificationPreference } from './notification-preference.entity';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsController } from './notifications.controller';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { ExternalDispatcherModule } from './external-dispatcher/external-dispatcher.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationEntity, NotificationPreference]),
    ExternalDispatcherModule,
  ],
  controllers: [NotificationsController, NotificationPreferencesController],
  providers: [NotificationsService, NotificationPreferencesService],
  exports: [NotificationsService, NotificationPreferencesService],
})
export class NotificationsModule {}
