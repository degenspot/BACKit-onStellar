import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformSettings } from './entities/platform-settings.entity';
import { UpdateConfigDto } from './dto/update-config.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface AdminParamsChangedEvent {
  feePercent?: number;
  contractId?: string;
  oracleContractId?: string;
  txHash: string;
  ledger: number;
}

@Injectable()
export class ConfigService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ConfigService.name);
  private readonly SINGLETON_ID = 1;

  constructor(
    @InjectRepository(PlatformSettings)
    private readonly settingsRepo: Repository<PlatformSettings>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Ensure the singleton row exists on every boot.
   * Safe to call multiple times — fully idempotent.
   */
  async onApplicationBootstrap() {
    await this.ensureSingleton();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async getSettings(): Promise<PlatformSettings> {
    const cacheKey = 'config:public';
    const cached = await this.cacheManager.get<PlatformSettings>(cacheKey);
    if (cached) return cached;

    const settings = await this.settingsRepo.findOneOrFail({
      where: { id: this.SINGLETON_ID },
    });
    await this.cacheManager.set(cacheKey, settings, 300_000);
    return settings;
  }

  /**
   * Called by the indexer whenever an AdminParamsChanged event is parsed
   * from the Soroban event stream. Only updates fields that are present
   * in the event payload — missing fields are left unchanged.
   */
  async applyAdminParamsChanged(
    event: AdminParamsChangedEvent,
  ): Promise<PlatformSettings> {
    const settings = await this.getSettings();

    if (event.feePercent !== undefined) {
      this.logger.log(
        `Fee updated: ${settings.feePercent}% → ${event.feePercent}% (ledger ${event.ledger})`,
      );
      settings.feePercent = event.feePercent;
    }

    if (event.contractId !== undefined) {
      settings.contractId = event.contractId;
    }

    if (event.oracleContractId !== undefined) {
      settings.oracleContractId = event.oracleContractId;
    }

    settings.lastUpdatedByTxHash = event.txHash;
    settings.lastUpdatedAtLedger = event.ledger;

    const saved = await this.settingsRepo.save(settings);
    await this.cacheManager.del('config:public');
    this.eventEmitter.emit('config.updated', {
      feePercent: saved.feePercent,
      source: 'indexer',
    });
    return saved;
  }

  async updateOffChainSettings(
    dto: UpdateConfigDto,
  ): Promise<PlatformSettings> {
    const settings = await this.getSettings();
    if (dto.feePercent !== undefined) settings.feePercent = dto.feePercent;
    if (dto.minStake !== undefined) settings.minStake = dto.minStake;
    if (dto.maxDuration !== undefined) settings.maxDuration = dto.maxDuration;
    if (dto.supportedTokens !== undefined) {
      settings.supportedTokens = dto.supportedTokens;
    }
    if (dto.contractAddresses !== undefined) {
      settings.contractAddresses = dto.contractAddresses;
    }

    const saved = await this.settingsRepo.save(settings);
    await this.cacheManager.del('config:public');
    this.eventEmitter.emit('config.updated', {
      feePercent: saved.feePercent,
      source: 'admin',
    });
    return saved;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async ensureSingleton(): Promise<void> {
    const existing = await this.settingsRepo.findOne({
      where: { id: this.SINGLETON_ID },
    });

    if (!existing) {
      await this.settingsRepo.save(
        this.settingsRepo.create({
          id: this.SINGLETON_ID,
          feePercent: parseFloat(process.env.DEFAULT_FEE_PERCENT ?? '1.0'),
          contractId: process.env.SOROBAN_CONTRACT_ID ?? null,
          oracleContractId: process.env.ORACLE_CONTRACT_ID ?? null,
          minStake: 0,
          maxDuration: 86400,
          supportedTokens: [],
          contractAddresses: {},
        }),
      );
      this.logger.log('PlatformSettings singleton created with defaults');
    }
  }
}
