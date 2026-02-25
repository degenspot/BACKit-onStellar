import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SorobanRpc, xdr } from '@stellar/stellar-sdk';
import { EventLog, EventType } from './event-log.entity';
import { PlatformSettings } from './entities/platform-settings.entity';
import { retryWithBackoff } from '../utils/retry';

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);

  constructor(
    private readonly rpcServer: SorobanRpc.Server,
    @InjectRepository(EventLog)
    private readonly eventLogRepository: Repository<EventLog>,
    @InjectRepository(PlatformSettings)
    private readonly platformSettingsRepository: Repository<PlatformSettings>,
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

  async getPlatformSettings(): Promise<PlatformSettings> {
    let settings = await this.platformSettingsRepository.findOne({
      where: { id: 1 },
    });

    if (!settings) {
      settings = this.platformSettingsRepository.create({
        id: 1,
        feePercent: 0,
      });
      await this.platformSettingsRepository.save(settings);
    }

    return settings;
  }

  async updatePlatformSettings(
    paramName: string,
    newValue: number,
    txHash: string,
    ledger: number,
  ): Promise<PlatformSettings> {
    let settings = await this.getPlatformSettings();

    // Update based on parameter name
    if (paramName === 'fee_percent' || paramName === 'feePercent') {
      settings.feePercent = newValue;
    }

    settings.lastUpdatedByTxHash = txHash;
    settings.lastUpdatedAtLedger = ledger;

    return await this.platformSettingsRepository.save(settings);
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
