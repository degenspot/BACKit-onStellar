import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { IndexerService } from './indexer.service';
import { IndexerController } from './indexer.controller';
import { EventParser } from './event-parser';
import { EventLog } from './event-log.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EventLog]),
    ScheduleModule.forRoot(),
    NotificationsModule,
  ],
  controllers: [IndexerController],
  providers: [IndexerService, EventParser],
  exports: [IndexerService],
})
export class IndexerModule { }
