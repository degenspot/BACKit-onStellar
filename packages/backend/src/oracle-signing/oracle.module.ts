import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OracleSigningService } from './oracle-signing.service';
import { OracleController } from './oracle.controller';
import { QueuesModule } from '../common/queues/queues.module';
import { OracleSigningQueueProcessor } from './oracle-signing.queue.processor';

@Module({
  imports: [ConfigModule, QueuesModule],
  controllers: [OracleController],
  providers: [OracleSigningService, OracleSigningQueueProcessor],
  exports: [OracleSigningService],
})
export class OracleModule {}
