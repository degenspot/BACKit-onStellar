import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IndexerService } from './indexer.service';
import { IndexerController } from './indexer.controller';
import { EventLog } from './event-log.entity';
import { PlatformConfigModule } from '../config/config.module';  

@Module({
  imports: [
    TypeOrmModule.forFeature([EventLog]),
    PlatformConfigModule,                                         
  ],
  controllers: [IndexerController],
  providers: [IndexerService],
  exports: [IndexerService],
})
export class IndexerModule {}