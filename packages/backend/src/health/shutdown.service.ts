import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * ShutdownService
 *
 * Tracks whether the application is shutting down so that readiness probes
 * can return 503 immediately, and saves the indexer checkpoint before the
 * database connection is closed.
 *
 * The heavy orchestration (stopping HTTP, queues, WebSocket) lives in
 * main.ts where we have direct access to the NestJS application instance.
 */
@Injectable()
export class ShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(ShutdownService.name);
  private shuttingDown = false;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Called by the health/ready endpoint to gate traffic during shutdown. */
  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /** Mark the application as shutting down. Called from main.ts signal handler. */
  beginShutdown(): void {
    this.shuttingDown = true;
  }

  /**
   * Persist the latest indexer checkpoint (last processed ledger) so that
   * a fresh instance can resume from the correct position.
   */
  async saveIndexerCheckpoint(): Promise<void> {
    try {
      if (!this.dataSource.isInitialized) {
        this.logger.warn(
          'DataSource not initialised — skipping checkpoint save',
        );
        return;
      }

      const result = await this.dataSource.query<{ ledger: number }[]>(
        `SELECT ledger FROM event_log ORDER BY ledger DESC LIMIT 1`,
      );

      const ledger = result?.[0]?.ledger ?? null;
      this.logger.log(
        ledger !== null
          ? `Indexer checkpoint saved — last ledger: ${ledger}`
          : 'No indexer events found — checkpoint not required',
      );
    } catch (err: any) {
      this.logger.error(`Failed to save indexer checkpoint: ${err.message}`);
    }
  }

  /** NestJS lifecycle hook — invoked when app.close() is called. */
  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(
      `onApplicationShutdown triggered (signal: ${signal ?? 'none'})`,
    );
  }
}
