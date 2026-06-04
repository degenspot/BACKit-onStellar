import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { OracleSigningService } from './oracle-signing.service';
import { DeadLetterService } from '../common/queues/dead-letter.service';
import { QUEUE_ORACLE_SIGNING } from '../common/queues/queues.constants';
import { PricePayload, SignedPriceData } from './oracle.interfaces';

export type OracleSigningJob = {
  payload: PricePayload;
};

@Processor(QUEUE_ORACLE_SIGNING)
export class OracleSigningQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(OracleSigningQueueProcessor.name);

  constructor(
    private readonly oracleSigningService: OracleSigningService,
    private readonly deadLetterService: DeadLetterService,
  ) {
    super();
  }

  async process(job: Job<OracleSigningJob>): Promise<SignedPriceData> {
    return this.oracleSigningService.sign(job.data.payload);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<OracleSigningJob>, err: Error) {
    if (!job) return;
    if (!this.deadLetterService.isFinalAttempt(job)) return;
    await this.deadLetterService.moveToDeadLetter(QUEUE_ORACLE_SIGNING, job);
    this.logger.error(`Oracle signing job permanently failed`, err.stack);
  }
}
