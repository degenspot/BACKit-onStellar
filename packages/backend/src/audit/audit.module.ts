import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit-log.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './interceptors/audit.interceptor';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]), // registers the repo for injection
  ],
  providers: [
    AuditService,
    AuditInterceptor, // provided here so @Audited() can inject it via DI
  ],
  controllers: [AuditController],
  exports: [AuditService, AuditInterceptor], // export so other modules can use @Audited()
})
export class AuditModule {}