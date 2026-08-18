import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PredictionCall, LeaderboardSnapshot } from './leaderboard.entity';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardCacheService } from './leaderboard-cache.service';
import { LeaderboardEventListener } from './leaderboard-event.listener';
import { LeaderboardSyncService } from './leaderboard-sync.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([PredictionCall, LeaderboardSnapshot]),
  ],
  controllers: [LeaderboardController],
  providers: [
    LeaderboardService,
    LeaderboardCacheService,
    LeaderboardEventListener,
    LeaderboardSyncService,
  ],
  exports: [LeaderboardService, LeaderboardCacheService],
})
export class LeaderboardModule {}
