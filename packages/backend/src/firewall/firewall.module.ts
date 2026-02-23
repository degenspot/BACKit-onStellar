import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockedRequest } from './entities/blocked-request.entity';
import { IpRule } from './entities/ip-rule.entity';
import { AuditModule } from 'src/audit/audit.module';
import { FirewallService } from './firewall.service';
import { FirewallMiddleware } from './firewall.middleware';
import { TurnstileGuard } from './guards/turnstile.guard';
import { FirewallController } from './firewall.controller';


@Module({
  imports: [
    TypeOrmModule.forFeature([IpRule, BlockedRequest]),
    AuditModule, // for @Audited() on the admin controller
  ],
  providers: [FirewallService, FirewallMiddleware, TurnstileGuard],
  controllers: [FirewallController],
  exports: [FirewallService, FirewallMiddleware, TurnstileGuard],
})
export class FirewallModule {}
