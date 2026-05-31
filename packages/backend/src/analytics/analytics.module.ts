import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsController, UserAnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { Call } from './entities/call.entity';
import { Stake } from './entities/stake.entity';
import { TokensModule } from '../token/tokens.module';
import { OracleModule } from '../oracle/oracle.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Call, Stake]),
    TokensModule,
    OracleModule,
  ],
  controllers: [AnalyticsController, UserAnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
