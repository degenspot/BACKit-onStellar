import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { Token } from './entities/token.entity';
import { TokensRepository } from './tokens.repository';
import { TokensService } from './tokens.service';
import { TokensController } from './tokens.controller';
import { TokensSyncWorker } from './tokens.sync.worker';

@Module({
  imports: [
    TypeOrmModule.forFeature([Token]),
    HttpModule,
    ScheduleModule.forRoot(), // safe to call in child modules
  ],
  controllers: [TokensController],
  providers: [TokensService, TokensRepository, TokensSyncWorker],
  exports: [TokensService, TokensRepository],
})
export class TokensModule {}
