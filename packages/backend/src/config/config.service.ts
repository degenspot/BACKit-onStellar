import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformSettings } from './entities/platform-settings.entity';

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
    return this.settingsRepo.findOneOrFail({
      where: { id: this.SINGLETON_ID },
    });
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

    return this.settingsRepo.save(settings);
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
        }),
      );
      this.logger.log('PlatformSettings singleton created with defaults');
    }
  }
}