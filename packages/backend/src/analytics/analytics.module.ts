import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AnalyticsController,
  PlatformAnalyticsController,
} from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { Call } from './entities/call.entity';
import { Stake } from './entities/stake.entity';
import { TokensModule } from '../token/tokens.module';
import { OracleModule } from '../oracle/oracle.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Call, Stake]),
    CacheModule.register(),
    TokensModule,
    OracleModule,
  ],
  controllers: [AnalyticsController, PlatformAnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
