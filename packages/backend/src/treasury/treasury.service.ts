import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { ConfigService } from '../config/config.service';
import { TreasuryEntry } from './treasury-entry.entity';

@Injectable()
export class TreasuryService {
  constructor(
    @InjectRepository(TreasuryEntry)
    private readonly treasuryRepository: Repository<TreasuryEntry>,
    private readonly configService: ConfigService,
  ) {}

  private resolveTokenAddress(): string {
    // Prefer a configured stake token contract if present.
    return (
      process.env.USDC_SAC_CONTRACT_ID ??
      process.env.STAKE_TOKEN_ADDRESS ??
      'UNKNOWN_TOKEN'
    );
  }

  /**
   * Record protocol fee for a settled payout claim.
   *
   * Current assumption: fee is charged as a percentage of the claimed amount.
   * If your on-chain event exposes an explicit fee amount, pass that in directly
   * and skip percentage calculation.
   */
  async recordFeeFromPayoutClaimed(params: {
    callId: string;
    claimedAmount: string;
    collectedAt: Date;
    tokenAddress?: string;
    feeAmountOverride?: string;
  }): Promise<TreasuryEntry> {
    const settings = await this.configService.getSettings();
    const tokenAddress = params.tokenAddress ?? this.resolveTokenAddress();

    const feeAmount =
      params.feeAmountOverride ??
      this.calculatePercentFee(params.claimedAmount, settings.feePercent);

    const entry = this.treasuryRepository.create({
      callId: params.callId,
      feeAmount,
      tokenAddress,
      collectedAt: params.collectedAt,
    });
    return this.treasuryRepository.save(entry);
  }

  private calculatePercentFee(amount: string, feePercent: number): string {
    const numeric = Number(amount ?? 0);
    const fee = (numeric * (feePercent ?? 0)) / 100;
    // Match 7-decimal token conventions used elsewhere in the DB.
    return fee.toFixed(7);
  }

  async getSummary(
    from?: Date,
    to?: Date,
  ): Promise<{
    totalFees: string;
    byToken: Array<{ tokenAddress: string; totalFees: string }>;
  }> {
    const where =
      from && to
        ? { collectedAt: Between(from, to) }
        : from
          ? { collectedAt: Between(from, new Date()) }
          : {};

    const rows: Array<{ tokenAddress: string; totalFees: string }> =
      await this.treasuryRepository
        .createQueryBuilder('t')
        .select('t.tokenAddress', 'tokenAddress')
        .addSelect('COALESCE(SUM(t.feeAmount), 0)', 'totalFees')
        .where(where as any)
        .groupBy('t.tokenAddress')
        .orderBy('totalFees', 'DESC')
        .getRawMany();

    const totalFees = rows
      .reduce((acc, r) => acc + Number(r.totalFees ?? 0), 0)
      .toFixed(7);

    return {
      totalFees,
      byToken: rows.map((r) => ({
        tokenAddress: r.tokenAddress,
        totalFees: Number(r.totalFees ?? 0).toFixed(7),
      })),
    };
  }

  async getHistory(params: {
    page: number;
    limit: number;
    from?: Date;
    to?: Date;
    tokenAddress?: string;
  }): Promise<{
    data: TreasuryEntry[];
    total: number;
    page: number;
    limit: number;
  }> {
    const qb = this.treasuryRepository
      .createQueryBuilder('t')
      .orderBy('t.collectedAt', 'DESC')
      .skip((params.page - 1) * params.limit)
      .take(params.limit);

    if (params.tokenAddress) {
      qb.andWhere('t.tokenAddress = :tokenAddress', {
        tokenAddress: params.tokenAddress,
      });
    }
    if (params.from)
      qb.andWhere('t.collectedAt >= :from', { from: params.from });
    if (params.to) qb.andWhere('t.collectedAt <= :to', { to: params.to });

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page: params.page, limit: params.limit };
  }
}
