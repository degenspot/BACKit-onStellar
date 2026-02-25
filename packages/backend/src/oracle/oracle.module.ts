// packages/backend/src/oracle/oracle.module.ts
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

@Module({
  imports: [
    TypeOrmModule.forFeature([OracleCall, OracleOutcome]),
    forwardRef(() => CallsModule),
  ],
  controllers: [OracleController],
  providers: [
    OracleService,
    PriceFetcherService,
    SigningService,
    {
      provide: SorobanRpc.Server,
      useFactory: () => {
        return new SorobanRpc.Server(
          process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
        );
      },
    },
  ],
  exports: [OracleService],
})
export class OracleModule { }