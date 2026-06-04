import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { Token } from './entities/token.entity';
import { PriceHistory } from './entities/price-history.entity';
import { TokensRepository } from './tokens.repository';
import { TokensService } from './tokens.service';
import { TokensController } from './tokens.controller';
import { AdminTokensController } from './admin-tokens.controller';
import { TokensSyncWorker } from './tokens.sync.worker';
import { PriceHistoryService } from './price-history.service';
import { PriceHistoryWorker } from './price-history.worker';

@Module({
  imports: [
    TypeOrmModule.forFeature([Token, PriceHistory]),
    HttpModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [TokensController, AdminTokensController],
  providers: [
    TokensService,
    TokensRepository,
    TokensSyncWorker,
    PriceHistoryService,
    PriceHistoryWorker,
  ],
  exports: [TokensService, TokensRepository, PriceHistoryService],
})
export class TokensModule {}
