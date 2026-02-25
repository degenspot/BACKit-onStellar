import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SorobanRpc, xdr } from '@stellar/stellar-sdk';
import { EventLog, EventType } from './event-log.entity';
import { retryWithBackoff } from '../utils/retry';

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);

  constructor(
    private readonly rpcServer: SorobanRpc.Server,
    @InjectRepository(EventLog)
    private readonly eventLogRepository: Repository<EventLog>,
  ) { }

  async getStatus() {
    const isRunning = true; // Placeholder for actual logic
    const totalEventsIndexed = await this.eventLogRepository.count();
    const latestEvent = await this.eventLogRepository.findOne({
      where: {},
      order: { ledger: 'DESC' },
    });

    return {
      isRunning,
      lastProcessedLedger: latestEvent?.ledger || null,
      totalEventsIndexed,
      latestEventLedger: latestEvent?.ledger || null,
      latestEventTimestamp: latestEvent?.timestamp || null,
    };
  }

  async getEventsByType(eventType: EventType, arg2?: any, arg3?: any, limit: number = 50) {
    return await this.eventLogRepository.find({
      where: { eventType: eventType },
      order: { ledger: 'DESC' },
      take: limit,
    });
  }

  // ─── Fetch Contract Events ───────────────────────────────────────────────────

  async fetchContractEvents(
    contractId: string,
    startLedger: number,
  ): Promise<SorobanRpc.Api.GetEventsResponse> {
    return retryWithBackoff(
      () =>
        this.rpcServer.getEvents({
          startLedger,
          filters: [
            {
              type: 'contract',
              contractIds: [contractId],
            },
          ],
        }),
      4,        // maxAttempts  → waits: 1s, 2s, 4s before final fail
      1000,     // baseDelayMs
      `fetchContractEvents(${contractId})`,
    );
  }

  // ─── Read Contract State ─────────────────────────────────────────────────────

  async readContractData(
    contractId: string,
    key: xdr.LedgerKey,
  ): Promise<SorobanRpc.Api.GetLedgerEntriesResponse> {
    return retryWithBackoff(
      () => this.rpcServer.getLedgerEntries(key),
      4,
      1000,
      `readContractData(${contractId})`,
    );
  }

  // ─── Get Latest Ledger ───────────────────────────────────────────────────────

  async getLatestLedger(): Promise<SorobanRpc.Api.GetLatestLedgerResponse> {
    return retryWithBackoff(
      () => this.rpcServer.getLatestLedger(),
      4,
      1000,
      'getLatestLedger',
    );
  }

  // ─── Submit Transaction ──────────────────────────────────────────────────────

  async submitTransaction(
    tx: Parameters<SorobanRpc.Server['sendTransaction']>[0],
  ): Promise<SorobanRpc.Api.SendTransactionResponse> {
    return retryWithBackoff(
      () => this.rpcServer.sendTransaction(tx),
      4,
      1000,
      'submitTransaction',
    );
  }
}
