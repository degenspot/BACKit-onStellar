import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OracleService } from './oracle.service';
import { PriceFetcherService } from './price-fetcher.service';
import { SigningService } from './signing.service';
import { OracleCall } from './entities/oracle-call.entity';
import { OracleOutcome } from './entities/oracle-outcome.entity';

@Module({
  imports: [TypeOrmModule.forFeature([OracleCall, OracleOutcome])],
  providers: [OracleService, PriceFetcherService, SigningService],
  exports: [OracleService],
})
export class OracleModule {}
