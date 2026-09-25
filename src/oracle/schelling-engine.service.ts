import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan, Not } from 'typeorm';
import { SchellingVote } from './entities/schelling-vote.entity';
import { StellarService } from '../stellar/stellar.service';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Worker } from 'bullmq';
import { IORedis } from 'ioredis';

@Injectable()
export class SchellingEngineService {
  private readonly logger = new Logger(SchellingEngineService.name);
  private readonly commitQueue = new Queue('schelling-commit', { connection: this.redis } as any);
  private readonly revealQueue = new Queue('schelling-reveal', { connection: this.redis } as any);
  private readonly consensusWorker: Worker;

  constructor(
    @InjectRepository(SchellingVote)
    private readonly voteRepository: Repository<SchellingVote>,
    private readonly stellarService: StellarService,
    private readonly configService: ConfigService,
    private readonly redis: IORedis
  ) {
    this.consensusWorker = new Worker('schelling-consensus', async job => {
      await this.calculateConsensus(job.data.oracleId);
    }, { connection: this.redis } as any);
  }

  async startCommitPhase(oracleId: string, durationMs: number): Promise<void> {
    const commitDeadline = new Date(Date.now() + durationMs);
    await this.commitQueue.add('commit', { oracleId, deadline: commitDeadline });
  }

  async startRevealPhase(oracleId: string, durationMs: number): Promise<void> {
    const revealDeadline = new Date(Date.now() + durationMs);
    await this.revealQueue.add('reveal', { oracleId, deadline: revealDeadline });
  }

  async recordCommit(
    oracleId: string,
    voterAddress: string,
    commitmentHash: string
  ): Promise<SchellingVote> {
    const existing = await this.voteRepository.findOne({
      where: { voterAddress, commitmentHash, oracleId },
      relations: ['oracle']
    });

    if (existing) {
      throw new Error('Duplicate commitment detected');
    }

    const vote = this.voteRepository.create({
      oracleId,
      voterAddress,
      commitmentHash,
      commitTimestamp: new Date()
    });

    return this.voteRepository.save(vote);
  }

  async recordReveal(
    oracleId: string,
    voterAddress: string,
    revealedSalt: string,
    revealedPrice: string
  ): Promise<SchellingVote> {
    const vote = await this.voteRepository.findOne({
      where: { voterAddress, oracleId, revealedSalt: null },
      relations: ['oracle']
    });

    if (!vote) {
      throw new Error('No pending commitment found');
    }

    // Validate commitment hash = keccak256(salt + price)
    const expectedHash = this.calculateCommitmentHash(revealedSalt, revealedPrice);
    if (vote.commitmentHash !== expectedHash) {
      throw new Error('Invalid reveal: commitment hash mismatch');
    }

    vote.revealedSalt = revealedSalt;
    vote.revealedPrice = revealedPrice;
    vote.revealTimestamp = new Date();

    return this.voteRepository.save(vote);
  }

  private calculateCommitmentHash(salt: string, price: string): string {
    // In production: use proper crypto library (e.g., crypto-js)
    return Buffer.from(salt + price).toString('hex');
  }

  async calculateConsensus(oracleId: string): Promise<void> {
    const votes = await this.voteRepository.find({
      where: {
        oracleId,
        revealedSalt: Not(null),
        revealTimestamp: Not(null)
      },
      order: { revealedPrice: 'ASC' }
    });

    if (votes.length < 3) {
      throw new Error('Insufficient votes for consensus');
    }

    // Calculate median price
    const medianPrice = this.calculateMedian(votes.map(v => parseFloat(v.revealedPrice)));

    // Calculate standard deviation
    const stdDev = this.calculateStandardDeviation(votes.map(v => parseFloat(v.revealedPrice)), medianPrice);

    // 2σ threshold for consensus
    const consensusThreshold = medianPrice + (2 * stdDev);

    // Mark consensus votes
    for (const vote of votes) {
      const price = parseFloat(vote.revealedPrice);
      vote.isConsensus = price <= consensusThreshold;
      vote.isSlashed = !vote.isConsensus;
    }

    await this.voteRepository.save(votes);

    // Execute payouts/slashing
    await this.executePayouts(oracleId, votes);
  }

  private calculateMedian(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  private calculateStandardDeviation(values: number[], mean: number): number {
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(variance);
  }

  private async executePayouts(oracleId: string, votes: SchellingVote[]): Promise<void> {
    const consensusVoters = votes.filter(v => v.isConsensus);
    const slashedVoters = votes.filter(v => v.isSlashed);

    // Distribute rewards to consensus voters
    for (const voter of consensusVoters) {
      const rewardAmount = this.configService.get('ORACLE_CONSENSUS_REWARD', '10');
      await this.stellarService.sendPayment(voter.voterAddress, rewardAmount);
    }

    // Slash outliers
    for (const voter of slashedVoters) {
      const slashAmount = this.configService.get('ORACLE_SLASH_AMOUNT', '5');
      await this.stellarService.sendPayment(voter.voterAddress, `-${slashAmount}`);
    }
  }
}