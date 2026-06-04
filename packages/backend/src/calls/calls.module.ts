import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallsRepository } from './calls.repository';
import { Call } from './entities/call.entity';
import { CallReport } from './entities/call-report.entity';
import { IpfsService } from '../storage/ipfs.service';

@Module({
  imports: [TypeOrmModule.forFeature([Call, CallReport])],
  controllers: [CallsController],
  providers: [CallsService, CallsRepository, IpfsService],
  exports: [CallsService, CallsRepository],
})
export class CallsModule {}
