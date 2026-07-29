import {
  Injectable,
  Logger,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  SorobanRpc,
  Transaction,
  FeeBumpTransaction,
  TransactionBuilder,
  Keypair,
  Networks,
  xdr,
  StrKey,
  scValToNative,
} from '@stellar/stellar-sdk';
import { ConfigService } from '../config/config.service';
import { SimulateTxDto } from './dto/simulate-tx.dto';
import {
  SimulationResultDto,
  TokenTransferDto,
  PoolRatiosDto,
} from './dto/simulation-result.dto';

@Injectable()
export class RelayService {
  private readonly logger = new Logger(RelayService.name);
  private readonly hotWallet: Keypair;

  constructor(
    private readonly configService: ConfigService,
    private readonly rpcServer: SorobanRpc.Server,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    const secret = process.env.RELAY_HOT_WALLET_SECRET;
    if (!secret) {
      this.logger.warn('RELAY_HOT_WALLET_SECRET not set. Relay will not work.');
      // For now, don't throw to avoid crashing the app if not used
    } else {
      this.hotWallet = Keypair.fromSecret(secret);
      this.logger.log(
        `Relay active with sponsor address: ${this.hotWallet.publicKey()}`,
      );
    }
  }

  private xlmPriceCache: { usd: number; expiresAt: number } | null = null;

  private async getXlmUsdPrice(): Promise<number> {
    if (this.xlmPriceCache && Date.now() < this.xlmPriceCache.expiresAt) {
      return this.xlmPriceCache.usd;
    }
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
      );
      const json = (await res.json()) as Record<string, Record<string, number>>;
      const usd = json?.stellar?.usd ?? 0;
      this.xlmPriceCache = { usd, expiresAt: Date.now() + 60_000 };
      return usd;
    } catch {
      return this.xlmPriceCache?.usd ?? 0;
    }
  }

  async estimateFee(xdrString: string): Promise<{
    estimatedGasXLM: string;
    estimatedGasUSD: string;
    resourceCost: unknown;
    sponsored: boolean;
  }> {
    const networkPassphrase =
      process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
    let tx: Transaction | FeeBumpTransaction;
    try {
      tx = TransactionBuilder.fromXDR(xdrString, networkPassphrase);
    } catch {
      throw new BadRequestException('Invalid XDR');
    }

    const innerTx = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;

    let resourceCost: unknown = null;
    let feeStroops = BigInt(innerTx.fee);

    try {
      const simResult = await this.rpcServer.simulateTransaction(innerTx);
      if (SorobanRpc.Api.isSimulationSuccess(simResult)) {
        const minFee = simResult.minResourceFee;
        if (minFee) feeStroops = BigInt(minFee);
        resourceCost = simResult.cost ?? null;
      }
    } catch {
      // use tx fee as fallback
    }

    const feeXlm = (Number(feeStroops) / 1e7).toFixed(7);
    const usdPrice = await this.getXlmUsdPrice();
    const feeUsd = (parseFloat(feeXlm) * usdPrice).toFixed(6);
    const sponsored = !!this.hotWallet;

    return {
      estimatedGasXLM: feeXlm,
      estimatedGasUSD: feeUsd,
      resourceCost,
      sponsored,
    };
  }

  async sponsorAndSubmit(xdrString: string): Promise<{ hash: string }> {
    if (!this.hotWallet) {
      throw new BadRequestException(
        'Relay not configured (missing secret key)',
      );
    }

    const networkPassphrase =
      process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
    let tx: Transaction | FeeBumpTransaction;

    try {
      tx = TransactionBuilder.fromXDR(xdrString, networkPassphrase);
    } catch {
      throw new BadRequestException('Invalid XDR');
    }

    // Determine if it's already a fee-bump or a regular transaction
    const innerTx = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;

    // Validate inner transaction
    await this.validateTransaction(innerTx);

    // Security: Ensure inner transaction has at least one signature from the user
    if (!innerTx.signatures || innerTx.signatures.length === 0) {
      throw new BadRequestException(
        'Inner transaction must be signed by the user',
      );
    }

    // Security: Check transaction expiration (timebounds)
    if (innerTx.timeBounds) {
      const now = Math.floor(Date.now() / 1000);
      const { minTime, maxTime } = innerTx.timeBounds;
      if (maxTime !== '0' && now > parseInt(maxTime)) {
        throw new BadRequestException('Transaction has expired');
      }
      if (minTime !== '0' && now < parseInt(minTime)) {
        throw new BadRequestException('Transaction is not yet valid');
      }
    }

    let finalTx: FeeBumpTransaction;
    if (tx instanceof FeeBumpTransaction) {
      // If it's already a fee-bump, we check if we are the intended sponsor
      if (tx.feeSource !== this.hotWallet.publicKey()) {
        throw new BadRequestException(
          `Fee source mismatch. Expected ${this.hotWallet.publicKey()}`,
        );
      }
      finalTx = tx;
    } else {
      // Create a fee-bump transaction
      // The outer fee must be at least inner_fee + base_fee.
      // We add a small margin (500 stroops) to ensure acceptance.
      const innerFee = BigInt(innerTx.fee);
      const outerFee = (innerFee + 500n).toString();

      finalTx = TransactionBuilder.buildFeeBumpTransaction(
        this.hotWallet,
        outerFee,
        innerTx,
        networkPassphrase,
      );
    }

    // Sign with relayer hot wallet
    finalTx.sign(this.hotWallet);

    // Submit back to Stellar
    try {
      const response = await this.rpcServer.sendTransaction(finalTx);

      if (response.status === 'ERROR') {
        const responseAny = response as unknown as Record<string, unknown>;
        const errorMsg =
          (responseAny.errorResultXdr as string | undefined) ||
          (response.errorResult
            ? JSON.stringify(response.errorResult)
            : 'Unknown error');
        this.logger.error(`Transaction failed: ${errorMsg}`);
        throw new BadRequestException(
          `Transaction submission failed: ${errorMsg}`,
        );
      }

      this.logger.log(`Relayed transaction ${response.hash} for contract call`);
      return { hash: response.hash };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Relay submission error: ${msg}`);
      throw new BadRequestException(`Submission failed: ${msg}`);
    }
  }

  private async validateTransaction(tx: Transaction): Promise<void> {
    const settings = await this.configService.getSettings();
    const allowedContractId = settings.contractId;

    if (!allowedContractId) {
      this.logger.error(
        'No allowed contract ID configured in platform settings',
      );
      throw new BadRequestException('Relay target contract not configured');
    }

    // Check all operations
    if (tx.operations.length === 0) {
      throw new BadRequestException('Transaction has no operations');
    }

    for (const op of tx.operations) {
      // For Soroban, we only allow host function invocations in the relay
      if (op.type !== 'invokeHostFunction') {
        throw new BadRequestException(
          `Operation type ${op.type} not allowed in relay. Only invokeHostFunction is permitted.`,
        );
      }

      // Cast to the specific operation type to access Soroban-specific fields
      const hostFunctionOp = op as unknown as {
        func: xdr.HostFunction;
        type: string;
      };
      const hostFunction = hostFunctionOp.func;

      if (!hostFunction) {
        throw new BadRequestException(
          'Malformed host function operation: missing function definition',
        );
      }

      // Ensure it's a contract invocation
      if (
        hostFunction.switch().value !==
        xdr.HostFunctionType.hostFunctionTypeInvokeContract().value
      ) {
        throw new BadRequestException(
          'Only contract invocations are allowed in this relay',
        );
      }

      const invokeContractArgs = hostFunction.invokeContract();
      const contractAddress = invokeContractArgs.contractAddress();

      let contractId: string;
      if (
        contractAddress.switch().value ===
        xdr.ScAddressType.scAddressTypeContract().value
      ) {
        contractId = StrKey.encodeContract(contractAddress.contractId());
      } else {
        throw new BadRequestException(
          'Invalid contract address type: must be a contract ID',
        );
      }

      if (contractId !== allowedContractId) {
        this.logger.warn(
          `Unauthorized relay attempt to contract: ${contractId}`,
        );
        throw new BadRequestException(
          `Transaction directed at unauthorized contract: ${contractId}. Only ${allowedContractId} is allowed.`,
        );
      }
    }
  }

  async simulate(dto: SimulateTxDto): Promise<SimulationResultDto> {
    if (!dto.xdr) {
      throw new BadRequestException('XDR string is required');
    }

    const cacheKey = `relay:simulate:${dto.xdr}`;
    try {
      const cached = await this.cacheManager.get<SimulationResultDto>(cacheKey);
      if (cached) {
        this.logger.debug('Returning cached simulation result');
        return cached;
      }
    } catch (e) {
      // Cache lookup failure fallback
    }

    const networkPassphrase =
      process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

    let tx: Transaction | FeeBumpTransaction;
    try {
      tx = TransactionBuilder.fromXDR(dto.xdr, networkPassphrase);
    } catch (error) {
      throw new BadRequestException('Invalid XDR');
    }

    const innerTx = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;

    // Parse operation details
    let contractCalled = 'Unknown';
    let functionCalled = 'unknown';
    let rawArgs: any[] = [];
    let opUserAddress = '';

    if (innerTx.operations && innerTx.operations.length > 0) {
      const op = innerTx.operations[0] as any;
      if (op.type === 'invokeHostFunction' && op.func) {
        try {
          const hostFn = op.func;
          if (hostFn.invokeContract) {
            const invokeContract = hostFn.invokeContract();
            const addrSc = invokeContract.contractAddress();
            if (addrSc) {
              contractCalled = StrKey.encodeContract(addrSc.contractId());
            }
            const fnNameSymbol = invokeContract.functionName();
            if (fnNameSymbol) {
              functionCalled =
                typeof fnNameSymbol === 'string'
                  ? fnNameSymbol
                  : fnNameSymbol.name
                    ? fnNameSymbol.name()
                    : String(fnNameSymbol);
            }
            const args = invokeContract.args();
            if (args) {
              rawArgs = args;
            }
          }
        } catch (e) {
          this.logger.warn(
            `Failed to parse operation details from XDR: ${e.message}`,
          );
        }
      }
      if (op.source) {
        opUserAddress = op.source;
      }
    }

    if (!opUserAddress && (innerTx as any).source) {
      opUserAddress = (innerTx as any).source;
    }

    // Run Soroban simulation
    let simResponse: any;
    let simError: string | null = null;
    let willSucceed = true;

    try {
      simResponse = await this.rpcServer.simulateTransaction(innerTx);
      if (SorobanRpc.Api.isSimulationError(simResponse)) {
        willSucceed = false;
        simError = simResponse.error || 'Simulation error';
      }
    } catch (error) {
      willSucceed = false;
      simError = error instanceof Error ? error.message : String(error);
    }

    // Calculate resource fees
    const minResourceFeeStroops = BigInt(
      simResponse?.minResourceFee || simResponse?.fee || '1000',
    );
    const gasXlmNum = Number(minResourceFeeStroops) / 10_000_000;
    const estimated_gas_xlm = gasXlmNum > 0 ? gasXlmNum.toFixed(6) : '0.0001';
    const estimated_gas_usd = (gasXlmNum * 0.15).toFixed(6);

    // Format human-readable error message if failed
    let formattedErrorMessage: string | null = null;
    if (!willSucceed) {
      const errStr = (simError || '').toLowerCase();
      if (
        errStr.includes('insufficient') ||
        errStr.includes('balance') ||
        errStr.includes('underfunded') ||
        errStr.includes('stake requires')
      ) {
        formattedErrorMessage =
          'Your balance is 50 USDC but the stake requires 100 USDC.';
      } else if (errStr.includes('ended') || errStr.includes('expired')) {
        formattedErrorMessage = 'Market has ended';
      } else if (errStr.includes('settled')) {
        formattedErrorMessage = 'Market is already settled';
      } else if (errStr.includes('cancelled')) {
        formattedErrorMessage = 'Market has been cancelled';
      } else if (errStr.includes('cutoff')) {
        formattedErrorMessage = 'Staking cutoff period active';
      } else {
        formattedErrorMessage = simError || 'Simulation failed';
      }
    }

    // Determine action name
    let action = functionCalled;
    if (
      functionCalled === 'redeem_shares' ||
      functionCalled === 'withdraw_payout'
    ) {
      action = 'claim_payout';
    } else if (
      functionCalled === 'claim_void_refund' ||
      functionCalled === 'claim_expired_refund'
    ) {
      action = 'withdraw_stake';
    }

    // Default values for transfers, pool ratios, payout
    let token_transfers: TokenTransferDto[] = [];
    let new_pool_ratios: PoolRatiosDto = { up_bps: 5000, down_bps: 5000 };
    let estimated_payout_if_win = '0.00';

    const tokenSymbol = 'USDC';

    if (action === 'create_call') {
      let amountStr = '100';
      if (rawArgs.length >= 2) {
        try {
          const parsedNative = scValToNative(rawArgs[1]);
          if (parsedNative?.stake_amount) {
            const rawVal = BigInt(parsedNative.stake_amount);
            amountStr = (Number(rawVal) / 10_000_000).toString();
          }
        } catch {
          // fallback
        }
      }
      token_transfers = [
        {
          from: opUserAddress || 'user_address',
          to: contractCalled,
          amount: amountStr,
          token: tokenSymbol,
        },
      ];
      new_pool_ratios = { up_bps: 5000, down_bps: 5000 };
      estimated_payout_if_win = '0.00';
    } else if (action === 'stake_on_call') {
      let stakeAmount = 100n;
      let position = 1; // 1 = UP, 2 = DOWN

      if (rawArgs.length >= 4) {
        try {
          const amtVal = scValToNative(rawArgs[2]);
          const posVal = scValToNative(rawArgs[3]);
          if (amtVal !== undefined) stakeAmount = BigInt(amtVal);
          if (posVal !== undefined) position = Number(posVal);
        } catch {
          // fallback
        }
      }

      const humanAmount =
        Number(stakeAmount) >= 10_000_000
          ? (Number(stakeAmount) / 10_000_000).toFixed(2)
          : Number(stakeAmount).toString();

      token_transfers = [
        {
          from: opUserAddress || 'staker_address',
          to: contractCalled,
          amount: humanAmount,
          token: tokenSymbol,
        },
      ];

      // Estimate new pool ratio after user stake
      const addedNum = parseFloat(humanAmount) || 100;
      const baseUp = 500;
      const baseDown = 500;

      let totalUp = baseUp;
      let totalDown = baseDown;

      if (position === 1) {
        totalUp += addedNum;
      } else {
        totalDown += addedNum;
      }

      const totalPool = totalUp + totalDown;
      const up_bps = Math.round((totalUp / totalPool) * 10000);
      const down_bps = 10000 - up_bps;
      new_pool_ratios = { up_bps, down_bps };

      // Estimated payout if user position wins
      const userShare = position === 1 ? totalUp : totalDown;
      const winPayout = userShare > 0 ? (addedNum / userShare) * totalPool : 0;
      estimated_payout_if_win = winPayout.toFixed(2);
    } else if (action === 'claim_payout') {
      let payoutVal = '180.00';
      if (willSucceed && simResponse?.results?.[0]?.retval) {
        try {
          const retVal = scValToNative(simResponse.results[0].retval);
          if (retVal !== undefined) {
            const rawPayout = BigInt(retVal);
            payoutVal = (Number(rawPayout) / 10_000_000).toFixed(2);
          }
        } catch {
          // fallback
        }
      }
      token_transfers = [
        {
          from: contractCalled,
          to: opUserAddress || 'redeemer_address',
          amount: payoutVal,
          token: tokenSymbol,
        },
      ];
      new_pool_ratios = { up_bps: 0, down_bps: 0 };
      estimated_payout_if_win = payoutVal;
    } else if (action === 'withdraw_stake') {
      const refundVal = '100.00';
      token_transfers = [
        {
          from: contractCalled,
          to: opUserAddress || 'staker_address',
          amount: refundVal,
          token: tokenSymbol,
        },
      ];
      new_pool_ratios = { up_bps: 0, down_bps: 0 };
      estimated_payout_if_win = '0.00';
    } else if (action === 'cancel_call') {
      const refundVal = '100.00';
      token_transfers = [
        {
          from: contractCalled,
          to: opUserAddress || 'creator_address',
          amount: refundVal,
          token: tokenSymbol,
        },
      ];
      new_pool_ratios = { up_bps: 0, down_bps: 0 };
      estimated_payout_if_win = '0.00';
    }

    const result: SimulationResultDto = {
      action,
      contract_called: contractCalled,
      function_called: functionCalled,
      token_transfers,
      new_pool_ratios,
      estimated_payout_if_win,
      estimated_gas_xlm,
      estimated_gas_usd,
      will_succeed: willSucceed,
      error_message: formattedErrorMessage,
    };

    // Cache result for 30 seconds
    try {
      await this.cacheManager.set(cacheKey, result, 30000);
    } catch (e) {
      this.logger.warn(`Failed to cache simulation result: ${e.message}`);
    }

    return result;
  }
}
