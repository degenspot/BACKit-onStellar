import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { SorobanRpc, Contract, xdr } from '@stellar/stellar-sdk';
import { OracleCall } from './entities/oracle-call.entity';
import { OracleOutcome } from './entities/oracle-outcome.entity';
import { retryWithBackoff, Retryable } from '../utils/retry';

@Injectable()
export class OracleService {
  private readonly logger = new Logger(OracleService.name);

  constructor(
    private readonly rpcServer: SorobanRpc.Server,
    @InjectRepository(OracleCall)
    private readonly oracleCallRepository: Repository<OracleCall>,
    @InjectRepository(OracleOutcome)
    private readonly oracleOutcomeRepository: Repository<OracleOutcome>,
  ) { }

  async createOracleCall(
    pairAddress: string,
    baseToken: string,
    quoteToken: string,
    strikePrice: number,
    callTime: Date,
  ): Promise<OracleCall> {
    const call = this.oracleCallRepository.create({
      pairAddress,
      baseToken,
      quoteToken,
      strikePrice,
      callTime,
    });
    return await this.oracleCallRepository.save(call);
  }

  async getPendingCalls(): Promise<OracleCall[]> {
    return await this.oracleCallRepository.find({
      where: { processedAt: IsNull(), failedAt: IsNull() },
    });
  }

  async getOutcomesForCall(callId: number): Promise<OracleOutcome[]> {
    return await this.oracleOutcomeRepository.find({
      where: { call: { id: callId } },
      relations: ['call'],
    });
  }

  // ─── Read Oracle Price via @Retryable Decorator ──────────────────────────────

  @Retryable(4, 1000)
  async fetchOraclePrice(
    contractId: string,
    assetSymbol: string,
  ): Promise<bigint> {
    const contract = new Contract(contractId);

    const tx = await this.rpcServer.simulateTransaction(
      // Caller is responsible for wrapping in a proper Transaction envelope;
      // this shows the contract-call shape expected by the oracle contract.
      contract.call('lastprice', xdr.ScVal.scvSymbol(assetSymbol)) as unknown as Parameters<
        SorobanRpc.Server['simulateTransaction']
      >[0],
    );

    if (SorobanRpc.Api.isSimulationError(tx)) {
      throw new Error(`Oracle simulation error for ${assetSymbol}: ${tx.error}`);
    }

    const result = (tx as SorobanRpc.Api.SimulateTransactionSuccessResponse).result;
    if (!result) {
      throw new Error(`No result returned for oracle price of ${assetSymbol}`);
    }

    // Decode the i128 price value from the XDR result
    return result.retval.i128().lo().toBigInt();
  }

  // ─── Fetch Multiple Asset Prices with Individual Retry ───────────────────────

  async fetchAllPrices(
    contractId: string,
    symbols: string[],
  ): Promise<Record<string, bigint>> {
    const results: Record<string, bigint> = {};

    await Promise.all(
      symbols.map(async (symbol) => {
        results[symbol] = await retryWithBackoff(
          () => this.fetchOraclePrice(contractId, symbol),
          4,
          1000,
          `fetchOraclePrice(${symbol})`,
        );
      }),
    );

    return results;
  }

  // ─── Simulate Contract Read (Generic) ────────────────────────────────────────

  async simulateContractRead(
    tx: Parameters<SorobanRpc.Server['simulateTransaction']>[0],
    label = 'simulateContractRead',
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
    return retryWithBackoff(
      () => this.rpcServer.simulateTransaction(tx),
      4,
      1000,
      label,
    );
  }
}
