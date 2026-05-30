// packages/backend/src/calls/calls.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallsRepository } from './calls.repository';
import { Call } from './entities/call.entity';
import { CallReport } from './entities/call-report.entity';
import { CallTrendingScore } from './entities/call-trending-score.entity';
import { OracleModule } from '../oracle/oracle.module';
import { CallsTrendingService } from './calls-trending.service';
import { CallsTrendingWorker } from './calls-trending.worker';

@Module({
  imports: [
    TypeOrmModule.forFeature([Call, CallReport, CallTrendingScore]),
    forwardRef(() => OracleModule),
  ],
  controllers: [CallsController],
  providers: [
    CallsService,
    CallsRepository,
    CallsTrendingService,
    CallsTrendingWorker,
  ],
  exports: [CallsService, CallsRepository, CallsTrendingService],
})
export class CallsModule {}
