import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from './entities/users.entity';
import { Badge } from './entities/badge.entity';
import { Follow } from './entities/follow.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [TypeOrmModule.forFeature([Users, Badge, Follow]), AnalyticsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
