import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CallsModule } from './calls/calls.module';
import { HealthModule } from './health/health.module';
import { OracleModule } from './oracle/oracle.module';
import { IndexerModule } from './indexer/indexer.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SearchModule } from './search/search.module';
import { UsersModule } from './user/users.module';
import { GatewaysModule } from './gateways/gateways.module';
import { AuditModule } from './audit/audit.module';
import { FirewallModule } from './firewall/firewall.module';
import { FirewallMiddleware } from './firewall/firewall.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
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
    // Enables internal event-driven communication between modules.
    // wildcard: true allows listeners like 'stake.*' to match 'stake.created' etc.
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
    }),
    CallsModule,
    HealthModule,
    OracleModule,
    IndexerModule,
    AnalyticsModule,
    NotificationsModule,
    SearchModule,
    UsersModule,
    GatewaysModule,
    AuditModule,
    FirewallModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule implements NestModule {
  /**
   * Apply FirewallMiddleware to all routes.
   * The /health path is excluded so load-balancer probes are never blocked.
   * Add more exclusions via .exclude() chaining if needed.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(FirewallMiddleware).exclude('/health').forRoutes('*');
  }
}
