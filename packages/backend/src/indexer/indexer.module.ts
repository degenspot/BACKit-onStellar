import { Module } from '@nestjs/common';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { IndexerService } from './indexer.service';
import { IndexerController } from './indexer.controller';
import { EventParser } from './event-parser';
import { EventLog } from './event-log.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EventLog]),
    ScheduleModule.forRoot(),
    NotificationsModule,
  ],
  controllers: [IndexerController],
  providers: [
    IndexerService,
    EventParser,
    {
      provide: SorobanRpc.Server,
      useFactory: () => {
        return new SorobanRpc.Server(
          process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
        );
      },
    },
  ],
  exports: [IndexerService],
})
export class IndexerModule { }
