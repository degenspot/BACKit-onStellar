import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { PayoutClaim, PayoutClaimStatus } from './entities/payout-claim.entity';

@Injectable()
export class PayoutsService {
  constructor(
    @InjectRepository(PayoutClaim)
    private readonly payoutClaimsRepository: Repository<PayoutClaim>,
  ) {}

  async listUserPayouts(stakerAddress: string): Promise<PayoutClaim[]> {
    return this.payoutClaimsRepository.find({
      where: { stakerAddress },
      order: { createdAt: 'DESC' },
    });
  }

  async listCallPayouts(
    callId: string,
  ): Promise<Array<PayoutClaim & { isOverdue: boolean }>> {
    const claims = await this.payoutClaimsRepository.find({
      where: { callId },
      order: { createdAt: 'DESC' },
    });
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return claims.map((claim) => ({
      ...claim,
      isOverdue:
        claim.status === PayoutClaimStatus.PENDING &&
        claim.createdAt.getTime() < sevenDaysAgo,
    }));
  }

  async upsertPendingClaim(
    callId: string,
    stakerAddress: string,
    amount: string,
  ): Promise<PayoutClaim> {
    const existing = await this.payoutClaimsRepository.findOne({
      where: { callId, stakerAddress },
    });

    if (existing) {
      existing.amount = amount;
      existing.status = PayoutClaimStatus.PENDING;
      return this.payoutClaimsRepository.save(existing);
    }

    return this.payoutClaimsRepository.save(
      this.payoutClaimsRepository.create({
        callId,
        stakerAddress,
        amount,
        status: PayoutClaimStatus.PENDING,
      }),
    );
  }

  async markClaimed(
    callId: string,
    stakerAddress: string,
    txHash: string,
    claimedAt: Date,
  ): Promise<PayoutClaim> {
    const existing = await this.payoutClaimsRepository.findOne({
      where: { callId, stakerAddress },
    });

    const claim =
      existing ??
      this.payoutClaimsRepository.create({
        callId,
        stakerAddress,
        amount: '0',
      });

    claim.txHash = txHash;
    claim.claimedAt = claimedAt;
    claim.status = PayoutClaimStatus.CLAIMED;
    return this.payoutClaimsRepository.save(claim);
  }

  async markFailed(
    callId: string,
    stakerAddress: string,
  ): Promise<PayoutClaim> {
    const existing = await this.payoutClaimsRepository.findOne({
      where: { callId, stakerAddress },
    });

    const claim =
      existing ??
      this.payoutClaimsRepository.create({
        callId,
        stakerAddress,
        amount: '0',
      });

    claim.status = PayoutClaimStatus.FAILED;
    return this.payoutClaimsRepository.save(claim);
  }

  async getOverdueUnclaimed(): Promise<PayoutClaim[]> {
    const threshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.payoutClaimsRepository.find({
      where: {
        status: PayoutClaimStatus.PENDING,
        createdAt: LessThan(threshold),
      },
      order: { createdAt: 'ASC' },
    });
  }
}
