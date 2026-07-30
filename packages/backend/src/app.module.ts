import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallsModule } from './calls/calls.module';
import { HealthModule } from './health/health.module';
import { OracleModule } from './oracle/oracle.module';
import { IndexerModule } from './indexer/indexer.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SearchModule } from './search/search.module';
import { UsersModule } from './user/users.module';
import { BookmarksModule } from './bookmarks/bookmarks.module';
import { AuthModule } from './auth/auth.module';
import { AppThrottlerModule } from './throttler/throttler.module';
import { OracleSigningModule } from './oracle-signing/oracle.module';
import { GatewaysModule } from './gateways/gateways.module';
import { AuditModule } from './audit/audit.module';
import { ActivityModule } from './activity/activity.module';
import { RelayModule } from './relay/relay.module';
import { FirewallModule } from './firewall/firewall.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { CommentsModule } from './comments/comments.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { LoggerModule } from './common/logger/logger.module';
import { AlertsModule } from './alerts/alerts.module';
import { StakesModule } from './stakes/stakes.module';
import { GraphqlApiModule } from './graphql-api/graphql-api.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    CacheModule.register({ isGlobal: true }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    LoggerModule,
    AppThrottlerModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(
        process.env.DB_PORT || process.env.POSTGRES_PORT || '5432',
        10,
      ),
      username:
        process.env.DB_USERNAME || process.env.POSTGRES_USER || 'postgres',
      password:
        process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || 'postgres',
      database: process.env.DB_NAME || process.env.POSTGRES_DB || 'backit',
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV === 'development',
    }),
    CallsModule,
    HealthModule,
    OracleModule,
    IndexerModule,
    AnalyticsModule,
    NotificationsModule,
    SearchModule,
    UsersModule,
    BookmarksModule,
    AuthModule,
    RelayModule,
    OracleSigningModule,
    GatewaysModule,
    AuditModule,
    ActivityModule,
    FirewallModule,
    LeaderboardModule,
    CommentsModule,
    AlertsModule,
    StakesModule,
    GraphqlApiModule,
  ],
  controllers: [],
  providers: [{ provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
