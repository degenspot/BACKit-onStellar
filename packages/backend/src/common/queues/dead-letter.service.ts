import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { Job, Queue } from 'bullmq';
import {
  QUEUE_DEAD_LETTER,
  QUEUE_IPFS_PINNING,
  QUEUE_NOTIFICATIONS,
  QUEUE_ORACLE_SIGNING,
  QueueName,
} from './queues.constants';
import {
  classifyFailure,
  DeadLetterClassification,
} from './dead-letter-classification.enum';
import {
  redactFailedReason,
  redactJobData,
  redactStacktrace,
} from './dead-letter-redaction';
import { validateSourceJobData } from './dead-letter-schema';

/** Lifecycle state of a dead-letter entry. */
export enum ReplayStatus {
  OPEN = 'OPEN',
  REPLAYED = 'REPLAYED',
  DISMISSED = 'DISMISSED',
}

const PAYLOAD_VERSION = 1;

/**
 * Persisted shape of a dead-lettered job, stored as the data of a job on
 * the QUEUE_DEAD_LETTER queue (nothing ever processes that queue, so it
 * behaves as a durable, append-mostly store rather than a work queue).
 *
 * `data`, `failedReason`, and `stacktrace` are always the *redacted* view
 * (see dead-letter-redaction.ts) - never the source job's raw payload.
 *
 * Entries written before this file existed won't have `version`,
 * `correlationId`, `classification`, `sourceTimestamp`, or replay/dismissal
 * fields at all. Every read path in this service backfills sensible
 * defaults for those (see `normalizeEntry`) rather than assuming they're
 * present - this is the "remaining compatible with existing entries"
 * requirement.
 */
export type DeadLetterPayload = {
  version?: number;
  correlationId?: string;
  sourceQueue: QueueName;
  jobName: string;
  jobId: string | number;
  attemptsMade: number;
  attempts: number;
  classification?: DeadLetterClassification;
  failedReason?: string;
  stacktrace?: string[];
  data: unknown;
  redactionFailed?: boolean;
  sourceTimestamp?: string;
  movedAt: string;
  replayStatus?: ReplayStatus;
  replayedAt?: string;
  replayedBy?: string;
  replayReason?: string;
  dismissedAt?: string;
  dismissedBy?: string;
  dismissReason?: string;
  lastReplayError?: string;
  lastReplayAttemptAt?: string;
};

/** Normalized entry returned by list/get/replay/dismiss - legacy fields backfilled. */
export type DeadLetterEntry = {
  dlqJobId: string;
  version: number;
  correlationId: string;
  sourceQueue: QueueName;
  jobName: string;
  jobId: string | number;
  attemptsMade: number;
  attempts: number;
  classification: DeadLetterClassification;
  data: unknown;
  redactionFailed: boolean;
  sourceTimestamp: string;
  movedAt: string;
  replayStatus: ReplayStatus;
  failedReason?: string;
  stacktrace?: string[];
  replayedAt?: string;
  replayedBy?: string;
  replayReason?: string;
  dismissedAt?: string;
  dismissedBy?: string;
  dismissReason?: string;
  lastReplayError?: string;
  lastReplayAttemptAt?: string;
};

export type ListDeadLetterEntriesQuery = {
  cursor?: string;
  limit?: number;
  sourceQueue?: QueueName;
  classification?: DeadLetterClassification;
  replayStatus?: ReplayStatus;
  from?: string;
  to?: string;
};

export type ListDeadLetterEntriesResult = {
  entries: DeadLetterEntry[];
  nextCursor: string | null;
};

export type ReplayResult =
  | { outcome: 'replayed'; entry: DeadLetterEntry }
  | { outcome: 'rejected'; reason: string };

export type DismissResult =
  | { outcome: 'dismissed'; entry: DeadLetterEntry }
  | { outcome: 'rejected'; reason: string };

const REPLAY_LOCK_TTL_MS = 30_000;
const LIST_SCAN_WINDOW = 200;
const REPLAYED_RETENTION_DAYS = 7;
const DISMISSED_RETENTION_DAYS = 30;
const STALE_OPEN_WARNING_DAYS = 14;

@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);

  private readonly sourceQueuesByName: Partial<Record<QueueName, Queue>>;

  constructor(
    @InjectQueue(QUEUE_DEAD_LETTER) private readonly dlq: Queue,
    @InjectQueue(QUEUE_ORACLE_SIGNING) private readonly oracleQueue: Queue,
    @InjectQueue(QUEUE_IPFS_PINNING) private readonly ipfsQueue: Queue,
    @InjectQueue(QUEUE_NOTIFICATIONS)
    private readonly notificationsQueue: Queue,
  ) {
    this.sourceQueuesByName = {
      [QUEUE_ORACLE_SIGNING]: this.oracleQueue,
      [QUEUE_IPFS_PINNING]: this.ipfsQueue,
      [QUEUE_NOTIFICATIONS]: this.notificationsQueue,
    };
  }

  isFinalAttempt(job: Job): boolean {
    const attempts = job.opts.attempts ?? 1;
    return job.attemptsMade >= attempts;
  }

  /**
   * Move a permanently-failed job into the dead-letter queue.
   *
   * `err` is optional only for call-site backward compatibility; passing it
   * is what lets the entry be classified (see dead-letter-classification.enum.ts).
   * Without it, the entry is stored as UNKNOWN classification.
   */
  async moveToDeadLetter(
    sourceQueue: QueueName,
    job: Job,
    err?: Error,
  ): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    const { data: redactedData, redactionFailed } = redactJobData(
      sourceQueue,
      job.data,
    );

    if (redactionFailed) {
      this.logger.warn(
        `dead_letter.redaction_failed sourceQueue=${sourceQueue} jobId=${job.id ?? ''} ` +
          `reason="job data did not match the expected shape for this queue"`,
      );
    }

    const payload: DeadLetterPayload = {
      version: PAYLOAD_VERSION,
      correlationId: randomUUID(),
      sourceQueue,
      jobName: job.name,
      jobId: job.id ?? '',
      attemptsMade: job.attemptsMade,
      attempts,
      classification: classifyFailure(err),
      failedReason: redactFailedReason(job.failedReason),
      stacktrace: redactStacktrace(job.stacktrace ?? undefined),
      data: redactedData,
      redactionFailed,
      sourceTimestamp: new Date(job.timestamp).toISOString(),
      movedAt: new Date().toISOString(),
      replayStatus: ReplayStatus.OPEN,
    };

    await this.dlq.add('dead-letter', payload, {
      // These options are effectively inert today (see cleanupExpiredEntries
      // below) - nothing ever processes QUEUE_DEAD_LETTER, so a job added
      // here never transitions to 'completed' or 'failed' for
      // removeOnComplete/removeOnFail to act on. Left in place for when/if
      // a worker is ever attached, but real retention is handled by the
      // cron job.
      removeOnComplete: { age: 60 * 60 * 24 * 30 },
      removeOnFail: false,
    });

    this.logger.log(
      `dead_letter.moved sourceQueue=${sourceQueue} jobId=${job.id ?? ''} ` +
        `classification=${payload.classification} correlationId=${payload.correlationId}`,
    );
  }

  /** Backfill defaults for entries written before these fields existed. */
  private normalizeEntry(
    dlqJobId: string,
    payload: DeadLetterPayload,
  ): DeadLetterEntry {
    return {
      dlqJobId,
      version: payload.version ?? 0,
      correlationId: payload.correlationId ?? `legacy-${dlqJobId}`,
      sourceQueue: payload.sourceQueue,
      jobName: payload.jobName,
      jobId: payload.jobId,
      attemptsMade: payload.attemptsMade,
      attempts: payload.attempts,
      classification:
        payload.classification ?? DeadLetterClassification.UNKNOWN,
      failedReason: payload.failedReason,
      stacktrace: payload.stacktrace,
      data: payload.data,
      redactionFailed: payload.redactionFailed ?? false,
      sourceTimestamp: payload.sourceTimestamp ?? payload.movedAt,
      movedAt: payload.movedAt,
      replayStatus: payload.replayStatus ?? ReplayStatus.OPEN,
      replayedAt: payload.replayedAt,
      replayedBy: payload.replayedBy,
      replayReason: payload.replayReason,
      dismissedAt: payload.dismissedAt,
      dismissedBy: payload.dismissedBy,
      dismissReason: payload.dismissReason,
      lastReplayError: payload.lastReplayError,
      lastReplayAttemptAt: payload.lastReplayAttemptAt,
    };
  }

  /**
   * List dead-letter entries with cursor pagination and optional filters.
   *
   * Implementation note: QUEUE_DEAD_LETTER is a BullMQ queue, not an
   * indexed table - jobs sit permanently in the 'waiting' state (nothing
   * ever processes this queue). Filters aren't backed by a database index;
   * this fetches an ordered window of candidate jobs from BullMQ and
   * filters in memory, advancing the cursor by how many raw jobs were
   * scanned (not how many matched). That's fine at DLQ scale (expect low
   * thousands of entries at most) but is a real scan, not an indexed
   * query - worth knowing before assuming this is O(1) per page.
   */
  async listEntries(
    query: ListDeadLetterEntriesQuery,
  ): Promise<ListDeadLetterEntriesResult> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const startOffset = query.cursor ? decodeCursor(query.cursor) : 0;

    const fromMs = query.from ? Date.parse(query.from) : undefined;
    const toMs = query.to ? Date.parse(query.to) : undefined;

    const entries: DeadLetterEntry[] = [];
    let offset = startOffset;
    let sawFullWindow = false;

    // Scan forward in bounded windows until `limit` matches are collected
    // or we run out of jobs. Capped at 20 windows (4000 raw jobs) as a
    // circuit breaker against pathological filters matching almost nothing
    // in a very large queue - callers get a `nextCursor` to keep paging.
    for (let windowsScanned = 0; windowsScanned < 20; windowsScanned++) {
      const jobs = await this.dlq.getJobs(
        ['waiting'],
        offset,
        offset + LIST_SCAN_WINDOW - 1,
        true,
      );
      sawFullWindow = jobs.length === LIST_SCAN_WINDOW;
      offset += jobs.length;

      for (const job of jobs) {
        const payload = job.data as DeadLetterPayload;
        const entry = this.normalizeEntry(String(job.id), payload);

        if (query.sourceQueue && entry.sourceQueue !== query.sourceQueue)
          continue;
        if (
          query.classification &&
          entry.classification !== query.classification
        )
          continue;
        if (query.replayStatus && entry.replayStatus !== query.replayStatus)
          continue;
        if (fromMs !== undefined && Date.parse(entry.movedAt) < fromMs)
          continue;
        if (toMs !== undefined && Date.parse(entry.movedAt) > toMs) continue;

        entries.push(entry);
        if (entries.length >= limit) break;
      }

      if (entries.length >= limit || jobs.length === 0) break;
    }

    const nextCursor =
      sawFullWindow || entries.length >= limit ? encodeCursor(offset) : null;

    return { entries, nextCursor };
  }

  async getEntry(dlqJobId: string): Promise<DeadLetterEntry | null> {
    const job = await this.dlq.getJob(dlqJobId);
    if (!job) return null;
    return this.normalizeEntry(dlqJobId, job.data as DeadLetterPayload);
  }

  /**
   * BullMQ's `queue.client` is typed as the cross-adapter `IRedisClient`
   * interface (ioredis, node-redis, Bun, ...), whose `set()` only exposes
   * `{ PX, EX }` - no `NX`. There's no type-safe way to express an atomic
   * "SET if not exists" through that interface directly, so the lock is
   * implemented as two tiny Lua scripts registered via `defineCommand`,
   * the same mechanism BullMQ itself uses internally for atomic ops. This
   * keeps the lock genuinely atomic (a single Redis-side EVAL) rather than
   * a GET-then-SET race, and keeps working regardless of adapter.
   */
  private lockCommandsReady = false;

  private async ensureLockCommands(
    client: Awaited<Queue['client']>,
  ): Promise<void> {
    if (this.lockCommandsReady) return;
    const anyClient = client as unknown as {
      dlqLockAcquire?: unknown;
      dlqLockRelease?: unknown;
      defineCommand: (
        name: string,
        def: { numberOfKeys: number; lua: string },
      ) => void;
    };

    if (!anyClient.dlqLockAcquire) {
      anyClient.defineCommand('dlqLockAcquire', {
        numberOfKeys: 1,
        lua: `
          if redis.call("SET", KEYS[1], ARGV[1], "NX", "PX", ARGV[2]) then
            return 1
          else
            return 0
          end
        `,
      });
    }
    if (!anyClient.dlqLockRelease) {
      anyClient.defineCommand('dlqLockRelease', {
        numberOfKeys: 1,
        lua: `
          if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
          else
            return 0
          end
        `,
      });
    }
    this.lockCommandsReady = true;
  }

  private async withReplayLock<T>(
    dlqJobId: string,
    fn: () => Promise<T>,
  ): Promise<T | { outcome: 'rejected'; reason: string }> {
    const client = await this.dlq.client;
    await this.ensureLockCommands(client);
    const commandClient = client as unknown as {
      runCommand: (name: string, args: unknown[]) => Promise<number>;
    };

    const lockKey = `dead-letter:replay-lock:${dlqJobId}`;
    const lockValue = randomUUID();

    const acquired = await commandClient.runCommand('dlqLockAcquire', [
      lockKey,
      lockValue,
      REPLAY_LOCK_TTL_MS,
    ]);
    if (acquired !== 1) {
      return {
        outcome: 'rejected',
        reason: 'another replay for this entry is already in progress',
      };
    }

    try {
      return await fn();
    } finally {
      // Best-effort compare-and-delete release; a stale lock self-expires
      // via PX regardless, so a failure here is not a correctness issue.
      await commandClient
        .runCommand('dlqLockRelease', [lockKey, lockValue])
        .catch(() => undefined);
    }
  }

  /**
   * Replay a dead-lettered job.
   *
   * Operates on the *original* job still sitting in its source queue (all
   * three source queues use `removeOnFail: false`, so a permanently-failed
   * job survives there in the 'failed' state) via BullMQ's own
   * `job.retry()`, rather than re-adding a new job from the DLQ's redacted
   * copy. This gets three things for free from BullMQ itself:
   *   - Atomicity: `retry()` is a Lua script that only proceeds if the job
   *     is still in the expected state, so two concurrent replays can't
   *     both succeed - the loser gets a thrown error, not a partial state.
   *   - Full (unredacted) data: schema validation runs against the real
   *     job, not the display-only redacted copy in the DLQ entry.
   *   - Dedup: it's the same job identity, not a new one, so any dedup the
   *     source queue relies on (e.g. notifications' `jobId: notificationId`)
   *     is untouched.
   * The Redis-level lock below is a second, coarser guard on top of that -
   * it prevents two requests from racing through the schema-validation and
   * state-check steps *before* either has called retry().
   */
  async replayEntry(
    dlqJobId: string,
    actorId: string,
    reason: string,
  ): Promise<ReplayResult> {
    const result = await this.withReplayLock(dlqJobId, () =>
      this.doReplay(dlqJobId, actorId, reason),
    );

    if ('outcome' in result && result.outcome === 'rejected') {
      this.logger.warn(
        `dead_letter.replay.rejected dlqJobId=${dlqJobId} reason="${result.reason}"`,
      );
      return result;
    }

    return result as ReplayResult;
  }

  private async doReplay(
    dlqJobId: string,
    actorId: string,
    reason: string,
  ): Promise<ReplayResult> {
    const dlqEntryJob = await this.dlq.getJob(dlqJobId);
    if (!dlqEntryJob) {
      return { outcome: 'rejected', reason: 'dead-letter entry not found' };
    }

    const payload = dlqEntryJob.data as DeadLetterPayload;
    const entry = this.normalizeEntry(dlqJobId, payload);

    if (entry.replayStatus !== ReplayStatus.OPEN) {
      return {
        outcome: 'rejected',
        reason: `entry is already ${entry.replayStatus.toLowerCase()}`,
      };
    }

    const sourceQueue = this.sourceQueuesByName[entry.sourceQueue];
    if (!sourceQueue) {
      return {
        outcome: 'rejected',
        reason: `replay is not supported for source queue "${entry.sourceQueue}"`,
      };
    }

    const sourceJob = await sourceQueue.getJob(String(entry.jobId));
    if (!sourceJob) {
      const failure = 'source job no longer exists in its source queue';
      await this.recordReplayFailure(dlqEntryJob, payload, failure);
      return { outcome: 'rejected', reason: failure };
    }

    const validation = validateSourceJobData(entry.sourceQueue, sourceJob.data);
    if (!validation.valid) {
      const failure = `source job failed schema validation: ${validation.reason}`;
      await this.recordReplayFailure(dlqEntryJob, payload, failure);
      return { outcome: 'rejected', reason: failure };
    }

    const state = await sourceJob.getState();
    if (state !== 'failed') {
      const failure = `source job is in state "${state}", not "failed" - not replayable`;
      await this.recordReplayFailure(dlqEntryJob, payload, failure);
      return { outcome: 'rejected', reason: failure };
    }

    try {
      await sourceJob.retry('failed');
    } catch (err: unknown) {
      const failure = `retry() rejected: ${err instanceof Error ? err.message : String(err)}`;
      await this.recordReplayFailure(dlqEntryJob, payload, failure);
      return { outcome: 'rejected', reason: failure };
    }

    const now = new Date().toISOString();
    const updated: DeadLetterPayload = {
      ...payload,
      replayStatus: ReplayStatus.REPLAYED,
      replayedAt: now,
      replayedBy: actorId,
      replayReason: reason,
      lastReplayError: undefined,
      lastReplayAttemptAt: now,
    };
    await dlqEntryJob.updateData(updated);

    this.logger.log(
      `dead_letter.replay.success dlqJobId=${dlqJobId} sourceQueue=${entry.sourceQueue} ` +
        `sourceJobId=${entry.jobId} actor=${actorId}`,
    );

    return {
      outcome: 'replayed',
      entry: this.normalizeEntry(dlqJobId, updated),
    };
  }

  private async recordReplayFailure(
    dlqEntryJob: Job,
    payload: DeadLetterPayload,
    failure: string,
  ): Promise<void> {
    const updated: DeadLetterPayload = {
      ...payload,
      lastReplayError: failure,
      lastReplayAttemptAt: new Date().toISOString(),
    };
    await dlqEntryJob.updateData(updated);
    this.logger.warn(
      `dead_letter.replay.failed dlqJobId=${dlqEntryJob.id} reason="${failure}"`,
    );
  }

  async dismissEntry(
    dlqJobId: string,
    actorId: string,
    reason: string,
  ): Promise<DismissResult> {
    const dlqEntryJob = await this.dlq.getJob(dlqJobId);
    if (!dlqEntryJob) {
      return { outcome: 'rejected', reason: 'dead-letter entry not found' };
    }

    const payload = dlqEntryJob.data as DeadLetterPayload;
    const entry = this.normalizeEntry(dlqJobId, payload);

    if (entry.replayStatus !== ReplayStatus.OPEN) {
      return {
        outcome: 'rejected',
        reason: `entry is already ${entry.replayStatus.toLowerCase()}`,
      };
    }

    const now = new Date().toISOString();
    const updated: DeadLetterPayload = {
      ...payload,
      replayStatus: ReplayStatus.DISMISSED,
      dismissedAt: now,
      dismissedBy: actorId,
      dismissReason: reason,
    };
    await dlqEntryJob.updateData(updated);

    this.logger.log(
      `dead_letter.dismissed dlqJobId=${dlqJobId} actor=${actorId}`,
    );

    return {
      outcome: 'dismissed',
      entry: this.normalizeEntry(dlqJobId, updated),
    };
  }

  /**
   * Retention cleanup: removes terminal-state entries past their retention
   * window. OPEN entries are never auto-deleted here, even if very old -
   * an unresolved failure silently disappearing is worse than it sitting
   * around; instead a stale OPEN entry just gets flagged in the metrics
   * log below for an operator to act on.
   */
  @Cron('0 3 * * *', { name: 'dead-letter-cleanup' })
  async cleanupExpiredEntries(): Promise<void> {
    const now = Date.now();
    const replayedCutoff = now - REPLAYED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const dismissedCutoff =
      now - DISMISSED_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    let offset = 0;
    let removed = 0;
    const BATCH = 200;

    for (;;) {
      const jobs = await this.dlq.getJobs(
        ['waiting'],
        offset,
        offset + BATCH - 1,
        true,
      );
      if (jobs.length === 0) break;

      for (const job of jobs) {
        const payload = job.data as DeadLetterPayload;
        const entry = this.normalizeEntry(String(job.id), payload);
        const timestampMs = Date.parse(
          entry.replayStatus === ReplayStatus.REPLAYED
            ? (entry.replayedAt ?? entry.movedAt)
            : entry.replayStatus === ReplayStatus.DISMISSED
              ? (entry.dismissedAt ?? entry.movedAt)
              : entry.movedAt,
        );

        const shouldRemove =
          (entry.replayStatus === ReplayStatus.REPLAYED &&
            timestampMs < replayedCutoff) ||
          (entry.replayStatus === ReplayStatus.DISMISSED &&
            timestampMs < dismissedCutoff);

        if (shouldRemove) {
          await job.remove();
          removed++;
        }
      }

      // Offset doesn't advance when jobs are removed mid-scan (removal
      // shifts later jobs down into the freed slots), so re-scan from the
      // same offset until a batch comes back with nothing left to remove.
      if (jobs.length < BATCH) break;
    }

    this.logger.log(`dead_letter.cleanup.removed count=${removed}`);
    await this.emitDepthMetrics();
  }

  @Cron('*/15 * * * *', { name: 'dead-letter-depth-metrics' })
  async emitDepthMetrics(): Promise<void> {
    const depthBySourceQueue = new Map<string, number>();
    const depthByClassification = new Map<string, number>();
    let oldestOpenMs: number | undefined;
    let openCount = 0;

    let offset = 0;
    for (;;) {
      const jobs = await this.dlq.getJobs(
        ['waiting'],
        offset,
        offset + LIST_SCAN_WINDOW - 1,
        true,
      );
      if (jobs.length === 0) break;
      offset += jobs.length;

      for (const job of jobs) {
        const entry = this.normalizeEntry(
          String(job.id),
          job.data as DeadLetterPayload,
        );
        depthBySourceQueue.set(
          entry.sourceQueue,
          (depthBySourceQueue.get(entry.sourceQueue) ?? 0) + 1,
        );
        depthByClassification.set(
          entry.classification,
          (depthByClassification.get(entry.classification) ?? 0) + 1,
        );

        if (entry.replayStatus === ReplayStatus.OPEN) {
          openCount++;
          const movedAtMs = Date.parse(entry.movedAt);
          if (oldestOpenMs === undefined || movedAtMs < oldestOpenMs) {
            oldestOpenMs = movedAtMs;
          }
        }
      }

      if (jobs.length < LIST_SCAN_WINDOW) break;
    }

    const oldestOpenAgeSeconds =
      oldestOpenMs !== undefined
        ? Math.floor((Date.now() - oldestOpenMs) / 1000)
        : 0;

    this.logger.log(
      `dead_letter.metrics openCount=${openCount} oldestOpenAgeSeconds=${oldestOpenAgeSeconds} ` +
        `bySourceQueue=${JSON.stringify(Object.fromEntries(depthBySourceQueue))} ` +
        `byClassification=${JSON.stringify(Object.fromEntries(depthByClassification))}`,
    );

    if (oldestOpenAgeSeconds > STALE_OPEN_WARNING_DAYS * 24 * 60 * 60) {
      this.logger.warn(
        `dead_letter.stale_open_entry oldestOpenAgeSeconds=${oldestOpenAgeSeconds} ` +
          `exceeds ${STALE_OPEN_WARNING_DAYS}-day staleness threshold`,
      );
    }
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf-8').toString('base64url');
}

function decodeCursor(cursor: string): number {
  const parsed = Number(Buffer.from(cursor, 'base64url').toString('utf-8'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
