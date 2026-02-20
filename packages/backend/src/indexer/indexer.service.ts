import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { EventLog, EventType } from './event-log.entity';
import { EventParser, ParsedEvent } from './event-parser';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerService.name);
  private server: SorobanRpc.Server;
  private lastProcessedLedger: number | null = null;
  private isProcessing = false;
  private pollingInterval: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(EventLog)
    private readonly eventLogRepository: Repository<EventLog>,
    private readonly eventParser: EventParser,
    private readonly notificationsService: NotificationsService,
  ) { }

  async onModuleInit() {
    this.logger.log('Initializing Indexer Service...');

    // Initialize Soroban RPC client
    const rpcUrl = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
    this.server = new SorobanRpc.Server(rpcUrl);

    // Load last processed ledger from database
    await this.loadLastProcessedLedger();

    this.logger.log(`Indexer initialized. Last processed ledger: ${this.lastProcessedLedger || 'None'}`);
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down Indexer Service...');
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
  }

  /**
   * Main polling function that runs every 5 seconds
   */
  @Cron('*/5 * * * * *')
  async pollEvents() {
    if (this.isProcessing) {
      this.logger.debug('Indexer is already processing events, skipping this cycle');
      return;
    }

    this.isProcessing = true;

    try {
      await this.processEvents();
    } catch (error) {
      this.logger.error('Error during event polling', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process events from SorobanRPC
   */
  private async processEvents() {
    try {
      // Get the starting ledger
      const startLedger = this.lastProcessedLedger
        ? this.lastProcessedLedger + 1
        : await this.getLatestLedger();

      this.logger.debug(`Polling events from ledger ${startLedger}`);

      // Get contract IDs from environment
      const callRegistryId = process.env.CALL_REGISTRY_CONTRACT_ID;
      const outcomeManagerId = process.env.OUTCOME_MANAGER_CONTRACT_ID;

      if (!callRegistryId || !outcomeManagerId) {
        this.logger.warn('Contract IDs not configured, skipping event polling');
        return;
      }

      // Fetch events from SorobanRPC
      const response = await this.server.getEvents({
        startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [callRegistryId, outcomeManagerId],
          },
        ],
        limit: 100,
      });

      this.logger.debug(`Found ${response.events.length} events`);

      // Process each event
      let processedCount = 0;
      for (const event of response.events) {
        const parsedEvent = this.eventParser.parseEvent(event);
        if (parsedEvent) {
          await this.persistEvent(parsedEvent);
          processedCount++;
        }
      }

      // Update checkpoint
      if (response.latestLedger && response.latestLedger > (this.lastProcessedLedger || 0)) {
        this.lastProcessedLedger = response.latestLedger;
        await this.saveCheckpoint(response.latestLedger);
        this.logger.log(`Processed ${processedCount} events. Checkpoint updated to ledger ${response.latestLedger}`);
      }

    } catch (error) {
      this.logger.error('Failed to process events', error);
      // Don't throw - let the next polling cycle retry
    }
  }

  /**
   * Persist parsed event to database
   */
  private async persistEvent(parsedEvent: ParsedEvent) {
    try {
      const eventLog = this.eventLogRepository.create({
        contractId: parsedEvent.contractId,
        eventType: parsedEvent.eventType,
        ledger: parsedEvent.ledger,
        txHash: parsedEvent.txHash,
        txOrder: parseInt(parsedEvent.txOrder, 10),
        eventData: parsedEvent.eventData,
        timestamp: parsedEvent.timestamp,
      });

      await this.eventLogRepository.save(eventLog);

      // Trigger in-app notifications based on event type
      await this.dispatchNotification(parsedEvent);

      this.logger.verbose(`Persisted event: ${parsedEvent.eventType} at ledger ${parsedEvent.ledger}`);
    } catch (error) {
      this.logger.error(`Failed to persist event: ${parsedEvent.eventType}`, error);
      throw error;
    }
  }

  /**
   * Dispatch notifications based on indexed on-chain event type.
   */
  private async dispatchNotification(parsedEvent: ParsedEvent) {
    try {
      const data = parsedEvent.eventData || {};
      if (parsedEvent.eventType === EventType.STAKE_ADDED) {
        // data.call_creator, data.backer, data.call_id expected from contract events
        if (data.call_creator && data.backer && data.call_id) {
          await this.notificationsService.notifyBackedCall(
            String(data.call_creator),
            String(data.backer),
            Number(data.call_id),
          );
        }
      } else if (parsedEvent.eventType === EventType.CALL_RESOLVED) {
        if (data.creator && data.call_id) {
          await this.notificationsService.notifyCallEnded(
            String(data.creator),
            Number(data.call_id),
          );
        }
      } else if (parsedEvent.eventType === EventType.CALL_SETTLED) {
        if (data.winner && data.call_id) {
          await this.notificationsService.notifyPayoutReady(
            String(data.winner),
            Number(data.call_id),
          );
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to dispatch notification for event ${parsedEvent.eventType}`, err);
      // Non-fatal — don't rethrow
    }
  }

  /**
   * Get the latest ledger from the network
   */
  private async getLatestLedger(): Promise<number> {
    try {
      const ledger = await this.server.getLatestLedger();
      return ledger.sequence;
    } catch (error) {
      this.logger.error('Failed to get latest ledger', error);
      throw error;
    }
  }

  /**
   * Load the last processed ledger from database
   */
  private async loadLastProcessedLedger() {
    try {
      const latestEvent = await this.eventLogRepository
        .createQueryBuilder('event')
        .select('MAX(event.ledger)', 'maxLedger')
        .getRawOne();

      this.lastProcessedLedger = latestEvent?.maxLedger ? Number(latestEvent.maxLedger) : null;
    } catch (error) {
      this.logger.warn('Failed to load last processed ledger, starting from latest', error);
      this.lastProcessedLedger = null;
    }
  }

  /**
   * Save checkpoint to database
   */
  private async saveCheckpoint(ledger: number) {
    // We store the checkpoint implicitly by tracking the max ledger in event_logs
    // In a production system, you might want a separate checkpoints table
    this.logger.debug(`Checkpoint saved at ledger ${ledger}`);
  }

  /**
   * Get events by type for a specific ledger range
   */
  async getEventsByType(
    eventType: EventType,
    startLedger?: number,
    endLedger?: number,
    limit = 100,
  ): Promise<EventLog[]> {
    const query = this.eventLogRepository
      .createQueryBuilder('event')
      .where('event.eventType = :eventType', { eventType })
      .orderBy('event.ledger', 'DESC')
      .addOrderBy('event.txOrder', 'DESC')
      .take(limit);

    if (startLedger) {
      query.andWhere('event.ledger >= :startLedger', { startLedger });
    }

    if (endLedger) {
      query.andWhere('event.ledger <= :endLedger', { endLedger });
    }

    return await query.getMany();
  }

  /**
   * Get all events for a specific contract
   */
  async getEventsByContract(
    contractId: string,
    limit = 100,
  ): Promise<EventLog[]> {
    return await this.eventLogRepository
      .createQueryBuilder('event')
      .where('event.contractId = :contractId', { contractId })
      .orderBy('event.ledger', 'DESC')
      .addOrderBy('event.txOrder', 'DESC')
      .take(limit)
      .getMany();
  }

  /**
   * Get indexer status
   */
  async getStatus() {
    const eventCount = await this.eventLogRepository.count();
    const latestEvent = await this.eventLogRepository
      .createQueryBuilder('event')
      .orderBy('event.ledger', 'DESC')
      .addOrderBy('event.txOrder', 'DESC')
      .getOne();

    return {
      isRunning: true,
      lastProcessedLedger: this.lastProcessedLedger,
      totalEventsIndexed: eventCount,
      latestEventLedger: latestEvent?.ledger || null,
      latestEventTimestamp: latestEvent?.timestamp || null,
    };
  }
}