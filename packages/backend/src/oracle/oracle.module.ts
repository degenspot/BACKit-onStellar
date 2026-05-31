import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OracleService } from './oracle.service';
import { OracleController } from './oracle.controller';
import { PriceFetcherService } from './price-fetcher.service';
import { SigningService } from './signing.service';
import { OracleCall } from './entities/oracle-call.entity';
import { OracleOutcome } from './entities/oracle-outcome.entity';
import { IpfsService } from '../storage/ipfs.service';

@Module({
  imports: [TypeOrmModule.forFeature([OracleCall, OracleOutcome])],
  controllers: [OracleController],
  providers: [OracleService, PriceFetcherService, SigningService, IpfsService],
  exports: [OracleService],
})
export class OracleModule {}
