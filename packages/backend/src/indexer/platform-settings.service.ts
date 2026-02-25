import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventLog, EventType } from './event-log.entity';
import { IndexerService } from './indexer.service';
import { EventParser } from './event-parser';

@Injectable()
export class PlatformSettingsService implements OnModuleInit {
  private readonly logger = new Logger(PlatformSettingsService.name);
  private lastProcessedLedger: number = 0;
  private readonly contractId: string;

  constructor(
    private readonly indexerService: IndexerService,
    private readonly eventParser: EventParser,
    @InjectRepository(EventLog)
    private readonly eventLogRepository: Repository<EventLog>,
  ) {
    this.contractId = process.env.STELLAR_CONTRACT_ID || '';
  }

  async onModuleInit() {
    // Initialize last processed ledger from database
    const latestEvent = await this.eventLogRepository.findOne({
      where: { eventType: EventType.ADMIN_PARAMS_CHANGED },
      order: { ledger: 'DESC' },
    });

    if (latestEvent) {
      this.lastProcessedLedger = latestEvent.ledger;
    }

    this.logger.log(
      `Platform Settings Service initialized. Last processed ledger: ${this.lastProcessedLedger}`,
    );
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async syncPlatformSettings() {
    try {
      if (!this.contractId) {
        this.logger.warn('Contract ID not configured, skipping sync');
        return;
      }

      const latestLedger = await this.indexerService.getLatestLedger();
      const startLedger = this.lastProcessedLedger + 1;

      if (startLedger > latestLedger.sequence) {
        return; // No new ledgers to process
      }

      this.logger.debug(
        `Syncing platform settings from ledger ${startLedger} to ${latestLedger.sequence}`,
      );

      const eventsResponse = await this.indexerService.fetchContractEvents(
        this.contractId,
        startLedger,
      );

      for (const event of eventsResponse.events) {
        const parsedEvent = this.eventParser.parseEvent(event);

        if (
          parsedEvent &&
          parsedEvent.eventType === EventType.ADMIN_PARAMS_CHANGED
        ) {
          // Save event to database
          const eventLog = this.eventLogRepository.create({
            eventId: `${event.ledger}-${event.id}`,
            pagingToken: event.pagingToken,
            contractId: parsedEvent.contractId,
            eventType: parsedEvent.eventType,
            ledger: parsedEvent.ledger,
            txHash: parsedEvent.txHash,
            txOrder: Number(parsedEvent.txOrder),
            eventData: parsedEvent.eventData,
            timestamp: parsedEvent.timestamp,
          });

          await this.eventLogRepository.save(eventLog);

          // Update platform settings
          const { paramName, newValue } = parsedEvent.eventData;
          await this.indexerService.updatePlatformSettings(
            paramName,
            newValue,
            parsedEvent.txHash,
            parsedEvent.ledger,
          );

          this.logger.log(
            `Updated platform setting: ${paramName} = ${newValue} (ledger: ${parsedEvent.ledger})`,
          );
        }
      }

      this.lastProcessedLedger = latestLedger.sequence;
    } catch (error) {
      this.logger.error('Failed to sync platform settings', error);
    }
  }
}
