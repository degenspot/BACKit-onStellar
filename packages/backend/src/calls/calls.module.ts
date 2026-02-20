import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallEntity } from './calls.entity';
import { IpfsService } from '../storage/ipfs.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TypeOrmModule.forFeature([CallEntity]), NotificationsModule],
  controllers: [CallsController],
  providers: [CallsService, IpfsService],
  exports: [CallsService],
})
export class CallsModule { }