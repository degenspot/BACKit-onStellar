import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, IsNull } from 'typeorm';
import { PriceFetcherService } from './price-fetcher.service';
import { SigningService } from './signing.service';
import { OracleCall } from './entities/oracle-call.entity';
import { OracleOutcome } from './entities/oracle-outcome.entity';
import * as nacl from 'tweetnacl';

@Injectable()
export class OracleService implements OnModuleInit {
  private readonly logger = new Logger(OracleService.name);
  private pollingInterval: NodeJS.Timeout;
  private readonly POLL_INTERVAL_MS = 30000; // 30 seconds

  constructor(
    @InjectRepository(OracleCall)
    private oracleCallRepository: Repository<OracleCall>,
    @InjectRepository(OracleOutcome)
    private oracleOutcomeRepository: Repository<OracleOutcome>,
    private priceFetcherService: PriceFetcherService,
    private signingService: SigningService,
  ) { }

  onModuleInit() {
    this.startPolling();
  }

  /**
   * Start polling for due calls every 30 seconds
   */
  private startPolling() {
    this.logger.log('Starting Oracle Worker polling...');

    this.pollingInterval = setInterval(async () => {
      try {
        await this.processDueCalls();
      } catch (error) {
        this.logger.error('Error during polling cycle:', error);
      }
    }, this.POLL_INTERVAL_MS);
  }

  /**
   * Stop the polling interval
   */
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.logger.log('Oracle Worker polling stopped');
    }
  }

  /**
   * Process all calls that are due (call time <= now) and haven't been processed
   */
  private async processDueCalls() {
    try {
      const now = new Date();

      // Find all due calls that haven't been processed yet
      const dueCalls = await this.oracleCallRepository.find({
        where: {
          callTime: LessThanOrEqual(now),
          processedAt: IsNull(),
        },
      });

      if (dueCalls.length === 0) {
        this.logger.debug('No due calls found');
        return;
      }

      this.logger.log(`Found ${dueCalls.length} due calls to process`);

      for (const call of dueCalls) {
        await this.processCall(call);
      }
    } catch (error) {
      this.logger.error('Error processing due calls:', error);
    }
  }

  /**
   * Process a single call: fetch price, sign outcome, submit transaction
   */
  private async processCall(call: OracleCall, retryCount = 0) {
    const MAX_RETRIES = 3;

    try {
      this.logger.log(`Processing call ${call.id} - pair: ${call.pairAddress}`);

      // Fetch price from DexScreener with fallback to StellarX/SDEX
      const price = await this.priceFetcherService.fetchPrice(
        call.pairAddress,
        call.baseToken,
        call.quoteToken,
      );

      if (!price) {
        throw new Error(`Failed to fetch price for pair ${call.pairAddress}`);
      }

      this.logger.log(`Fetched price for ${call.pairAddress}: ${price}`);

      // Determine outcome (above or below strike price)
      const outcome = price >= call.strikePrice ? 'YES' : 'NO';

      // Create message to sign: callId + price + timestamp
      const messageData = {
        callId: call.id,
        price: price,
        timestamp: Date.now(),
        outcome: outcome,
        pairAddress: call.pairAddress,
      };

      // Sign the outcome with ed25519
      const signature = this.signingService.signOutcome(messageData);

      // Submit transaction to OutcomeManager contract
      await this.submitOutcomeTransaction(call, outcome, price, signature);

      // Record the outcome
      const oracleOutcome = new OracleOutcome();
      oracleOutcome.call = call;
      oracleOutcome.price = price;
      oracleOutcome.outcome = outcome;
      oracleOutcome.signature = signature;
      oracleOutcome.transactionHash = signature; // Placeholder - replace with actual tx hash

      await this.oracleOutcomeRepository.save(oracleOutcome);

      // Mark call as processed
      call.processedAt = new Date();
      await this.oracleCallRepository.save(call);

      this.logger.log(
        `Successfully processed call ${call.id}: outcome=${outcome}, price=${price}`,
      );
    } catch (error) {
      this.logger.error(
        `Error processing call ${call.id} (attempt ${retryCount + 1}/${MAX_RETRIES}):`,
        error,
      );

      if (retryCount < MAX_RETRIES) {
        // Exponential backoff: 10s, 30s, 60s
        const delayMs = Math.pow(2, retryCount) * 10000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        await this.processCall(call, retryCount + 1);
      } else {
        this.logger.error(
          `Failed to process call ${call.id} after ${MAX_RETRIES} retries`,
        );
        // Mark call as failed
        call.failedAt = new Date();
        call.failureReason = error.message;
        await this.oracleCallRepository.save(call);
      }
    }
  }

  /**
   * Submit outcome transaction to OutcomeManager contract
   * This is a placeholder - implement based on your contract interaction library
   */
  private async submitOutcomeTransaction(
    call: OracleCall,
    outcome: string,
    price: number,
    signature: string,
  ): Promise<void> {
    try {
      // TODO: Implement actual contract transaction submission
      // This should call the OutcomeManager contract with:
      // - callId
      // - outcome (YES/NO)
      // - price
      // - signature (ed25519)

      this.logger.log(
        `Submitting outcome transaction for call ${call.id}: outcome=${outcome}, price=${price}`,
      );

      // Placeholder implementation
      // Example using web3.js or ethers.js depending on your setup
      // const tx = await outcomeManagerContract.submitOutcome(
      //   call.id,
      //   outcome,
      //   price,
      //   signature
      // );
      // await tx.wait();
    } catch (error) {
      this.logger.error(
        `Failed to submit outcome transaction for call ${call.id}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Create a new oracle call to be processed
   */
  async createOracleCall(
    pairAddress: string,
    baseToken: string,
    quoteToken: string,
    strikePrice: number,
    callTime: Date,
  ): Promise<OracleCall> {
    const oracleCall = new OracleCall();
    oracleCall.pairAddress = pairAddress;
    oracleCall.baseToken = baseToken;
    oracleCall.quoteToken = quoteToken;
    oracleCall.strikePrice = strikePrice;
    oracleCall.callTime = callTime;

    return await this.oracleCallRepository.save(oracleCall);
  }

  /**
   * Get all pending oracle calls
   */
  async getPendingCalls(): Promise<OracleCall[]> {
    return await this.oracleCallRepository.find({
      where: {
        processedAt: IsNull(),
        failedAt: IsNull(),
      },
    });
  }

  /**
   * Get oracle outcomes for a specific call
   */
  async getOutcomesForCall(callId: number): Promise<OracleOutcome[]> {
    return await this.oracleOutcomeRepository.find({
      where: {
        call: { id: callId },
      },
    });
  }
}
