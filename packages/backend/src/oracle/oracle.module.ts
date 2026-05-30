import { Module, forwardRef } from '@nestjs/common';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OracleService } from './oracle.service';
import { OracleController } from './oracle.controller';
import { PriceFetcherService } from './price-fetcher.service';
import { SigningService } from './signing.service';
import { OracleCall } from './entities/oracle-call.entity';
import { OracleOutcome } from './entities/oracle-outcome.entity';
import { CallsModule } from '../calls/calls.module';
import { CoinGeckoService } from './coinGeko.service';
import { PriceDeviationService } from './deiviation.service';
import { PriceDeviationWorker } from './deviation.worker';
import { PriceDeviationLog } from './entities/log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([OracleCall, OracleOutcome, PriceDeviationLog]),
    forwardRef(() => CallsModule),
  ],
  controllers: [OracleController],
  providers: [
    OracleService,
    PriceFetcherService,
    SigningService,
    CoinGeckoService,
    PriceDeviationService,
    PriceDeviationWorker,
    {
      provide: SorobanRpc.Server,
      useFactory: () => {
        return new SorobanRpc.Server(
          process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
        );
      },
    },
  ],
  exports: [OracleService, PriceDeviationService],
})
export class OracleModule {}
