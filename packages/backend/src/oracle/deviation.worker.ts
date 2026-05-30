import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PriceDeviationService } from './deiviation.service';
import { PRICE_DEVIATION_CONFIG } from './config/oracle.config';
import { OraclePriceEntity } from './entities/storedOraclePrice.entity';

@Injectable()
export class PriceDeviationWorker {
  private readonly logger = new Logger(PriceDeviationWorker.name);

  constructor(
    private readonly deviationService: PriceDeviationService,

    /**
     * Inject your oracle price repository here.
     * e.g. @InjectRepository(OraclePriceEntity)
     */
    @InjectRepository(OraclePriceEntity)
    private readonly oraclePriceRepo: Repository<OraclePriceEntity>,
  ) {}

  @Cron(PRICE_DEVIATION_CONFIG.cronExpression)
  async runCheck(): Promise<void> {
    this.logger.debug('Price deviation check starting…');

    if (this.deviationService.isSigningHalted()) {
      this.logger.warn(
        'Signing is currently halted due to a previous breach. ' +
          'Skipping check until halt is cleared by an operator.',
      );
      return;
    }

    let oraclePrices: OraclePriceEntity[];

    try {
      // Fetch the latest stored price per symbol.
      // Adjust this query to match your schema — e.g. a `latestPrice` view,
      // or a subquery for MAX(createdAt) per symbol.
      oraclePrices = await this.oraclePriceRepo
        .createQueryBuilder('op')
        .select(['op.symbol', 'op.usdPrice'])
        .distinctOn(['op.symbol'])
        .orderBy('op.symbol')
        .addOrderBy('op.createdAt', 'DESC')
        .getMany();
    } catch (err) {
      this.logger.error('Failed to fetch oracle prices from DB', err);
      return;
    }

    if (!oraclePrices.length) {
      this.logger.warn(
        'No oracle prices found in DB — skipping deviation check.',
      );
      return;
    }

    try {
      const results =
        await this.deviationService.runDeviationCheck(oraclePrices);
      const breaches = results.filter((r) => r.breached);

      this.logger.log(
        `Deviation check complete. ${results.length} symbol(s) checked, ` +
          `${breaches.length} breach(es) detected.`,
      );
    } catch (err) {
      this.logger.error('Price deviation check failed', err);
    }
  }
}
