import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
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
import { AuthModule } from './auth/auth.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    CacheModule.register({ isGlobal: true }),
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
      synchronize: process.env.NODE_ENV !== 'production',
    }),
    CallsModule,
    HealthModule,
    OracleModule,
    IndexerModule,
    AnalyticsModule,
    NotificationsModule,
    SearchModule,
    UsersModule,
    AuthModule,
  ],
  controllers: [],
  providers: [{ provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
