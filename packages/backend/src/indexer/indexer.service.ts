import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SorobanRpc, xdr } from '@stellar/stellar-sdk';
import { EventLog, EventType } from './event-log.entity';
import { PlatformSettings } from './entities/platform-settings.entity';
import { retryWithBackoff } from '../utils/retry';
import { ConfigService } from '../config/config.service';
import { parseAdminParamsChanged } from './parsers/admin-params.parser';

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);
  private readonly contractId = process.env.SOROBAN_CONTRACT_ID ?? '';

  constructor(
    private readonly rpcServer: SorobanRpc.Server,
    @InjectRepository(EventLog)
    private readonly eventLogRepository: Repository<EventLog>,
    @InjectRepository(PlatformSettings)
    private readonly platformSettingsRepository: Repository<PlatformSettings>,
    private readonly configService: ConfigService,
  ) {}

  // ─── Status ───────────────────────────────────────────────────────────────

  async getStatus() {
    const isRunning = true;
    const totalEventsIndexed = await this.eventLogRepository.count();
    const latestEvent = await this.eventLogRepository.findOne({
      where: {},
      order: { ledger: 'DESC' },
    });

    return {
      isRunning,
      lastProcessedLedger:  latestEvent?.ledger    ?? null,
      totalEventsIndexed,
      latestEventLedger:    latestEvent?.ledger    ?? null,
      latestEventTimestamp: latestEvent?.timestamp ?? null,
    };
  }

  async getEventsByType(
    eventType: EventType,
    arg2?: any,
    arg3?: any,
    limit: number = 50,
  ) {
    return this.eventLogRepository.find({
      where: { eventType },
      order: { ledger: 'DESC' },
      take: limit,
    });
  }

  // ─── Main Entry Point ─────────────────────────────────────────────────────

  async processNewEvents(): Promise<void> {
    if (!this.contractId) {
      this.logger.warn('SOROBAN_CONTRACT_ID not set — skipping indexer tick');
      return;
    }

    try {
      const startLedger = await this.resolveStartLedger();
      const response    = await this.fetchContractEvents(this.contractId, startLedger);

      for (const event of response.events) {
        await this.dispatchEvent(event);
      }
    } catch (err: any) {
      this.logger.error(`Indexer tick failed: ${err.message}`);
    }
  }

  // ─── Event Dispatcher ─────────────────────────────────────────────────────

  private async dispatchEvent(event: SorobanRpc.Api.EventResponse): Promise<void> {
    const topics = event.topic;
    const data   = event.value;
    const txHash = event.txHash;
    const ledger = event.ledger;

    if (topics.length === 0) return;

    const firstTopic = topics[0];
    if (firstTopic.switch() !== xdr.ScValType.scvSymbol()) return;

    const eventName = firstTopic.sym().toString();

    switch (eventName) {
      case 'AdminParamsChanged':
        await this.handleAdminParamsChanged(topics, data, txHash, ledger);
        break;

      // ── extend here as you add more contract events ───────────────────
      // case 'MarketCreated':  await this.handleMarketCreated(...); break;
      // case 'BetPlaced':      await this.handleBetPlaced(...);     break;

      default:
        this.logger.debug(`Unhandled event type: ${eventName}`);
        break;
    }
  }

  // ─── AdminParamsChanged ───────────────────────────────────────────────────

  private async handleAdminParamsChanged(
    topics: xdr.ScVal[],
    data: xdr.ScVal,
    txHash: string,
    ledger: number,
  ): Promise<void> {
    const parsed = parseAdminParamsChanged(topics, data, txHash, ledger);
    if (!parsed) return;

    await this.configService.applyAdminParamsChanged(parsed);

    this.logger.log(
      `AdminParamsChanged applied — feePercent: ${parsed.feePercent}% ` +
      `ledger: ${ledger} tx: ${txHash}`,
    );

    await this.eventLogRepository.save(
      this.eventLogRepository.create({
        eventId:     `${txHash}-admin-params`,
        pagingToken: `${ledger}-${txHash}`,
        contractId:  this.contractId,
        eventType:   EventType.ADMIN_PARAMS_CHANGED,
        ledger,
        txHash,
        txOrder:     0,
        eventData:   parsed,
        timestamp:   new Date(),
      }),
    );
  }

  // ─── Platform Settings ────────────────────────────────────────────────────

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
    const settings = await this.getPlatformSettings();

    if (paramName === 'fee_percent' || paramName === 'feePercent') {
      settings.feePercent = newValue;
    }

    settings.lastUpdatedByTxHash = txHash;
    settings.lastUpdatedAtLedger = ledger;

    return await this.platformSettingsRepository.save(settings);
  }

  // ─── Fetch Contract Events ────────────────────────────────────────────────

  async fetchContractEvents(
    contractId: string,
    startLedger: number,
  ): Promise<SorobanRpc.Api.GetEventsResponse> {
    return retryWithBackoff(
      () =>
        this.rpcServer.getEvents({
          startLedger,
          filters: [{ type: 'contract', contractIds: [contractId] }],
        }),
      4,
      1000,
      `fetchContractEvents(${contractId})`,
    );
  }

  // ─── Read Contract State ──────────────────────────────────────────────────

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

  // ─── Get Latest Ledger ────────────────────────────────────────────────────

  async getLatestLedger(): Promise<SorobanRpc.Api.GetLatestLedgerResponse> {
    return retryWithBackoff(
      () => this.rpcServer.getLatestLedger(),
      4,
      1000,
      'getLatestLedger',
    );
  }

  // ─── Submit Transaction ───────────────────────────────────────────────────

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

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async resolveStartLedger(): Promise<number> {
    const latestEvent = await this.eventLogRepository.findOne({
      where: {},
      order: { ledger: 'DESC' },
    });

    if (latestEvent?.ledger) {
      return latestEvent.ledger + 1;
    }

    const latest = await this.getLatestLedger();
    return Math.max(latest.sequence - 5, 1);
  }
}