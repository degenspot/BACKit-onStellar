// packages/backend/src/calls/calls.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallsRepository } from './calls.repository';
import { Call } from './entities/call.entity';
import { CallReport } from './entities/call-report.entity';
import { OracleModule } from '../oracle/oracle.module';   

@Module({
  imports: [
    TypeOrmModule.forFeature([Call, CallReport]),
    forwardRef(() => OracleModule),                       
  ],
  controllers: [CallsController],
  providers: [CallsService, CallsRepository],
  exports: [CallsService, CallsRepository],
})
export class CallsModule {}