import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationEntity } from './notification.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ExternalDispatcherModule } from './external-dispatcher/external-dispatcher.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationEntity]),
    ExternalDispatcherModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
