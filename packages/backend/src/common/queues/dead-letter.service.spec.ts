import {
  DeadLetterService,
  DeadLetterPayload,
  ReplayStatus,
} from './dead-letter.service';
import { DeadLetterClassification } from './dead-letter-classification.enum';
import {
  QUEUE_IPFS_PINNING,
  QUEUE_NOTIFICATIONS,
  QUEUE_ORACLE_SIGNING,
} from './queues.constants';

// ─── Fakes ──────────────────────────────────────────────────────────────────
//
// A minimal in-memory stand-in for BullMQ's Queue/Job that supports exactly
// the surface DeadLetterService uses: add, getJob, getJobs, client (with
// defineCommand/runCommand for the Lua-script lock), and per-job
// updateData/retry/getState/remove. This lets the tests exercise real
// pagination-window and lock-contention logic rather than mocking every
// method call directly.

type FakeJobState = 'waiting' | 'failed' | 'completed';

class FakeJob {
  id: string;
  name: string;
  data: unknown;
  attemptsMade = 0;
  opts: { attempts?: number } = {};
  timestamp: number;
  failedReason?: string;
  stacktrace?: string[];
  state: FakeJobState;

  constructor(
    id: string,
    name: string,
    data: unknown,
    state: FakeJobState = 'waiting',
  ) {
    this.id = id;
    this.name = name;
    this.data = data;
    this.timestamp = Date.now();
    this.state = state;
  }

  async updateData(data: unknown): Promise<void> {
    this.data = data;
  }

  async getState(): Promise<FakeJobState> {
    return this.state;
  }

  async retry(fromState: FakeJobState): Promise<void> {
    if (this.state !== fromState) {
      throw new Error(
        `Job ${this.id} is not in state "${fromState}" (currently "${this.state}")`,
      );
    }
    this.state = 'waiting';
    this.attemptsMade = 0;
  }

  async remove(): Promise<void> {
    // handled by FakeQueue
  }
}

class FakeRedisClient {
  private store = new Map<string, { value: string; expiresAt: number }>();
  private commands = new Map<string, (args: unknown[]) => number>();

  defineCommand(name: string, def: { lua: string }): void {
    if (name === 'dlqLockAcquire') {
      this.commands.set('dlqLockAcquire', (args) => {
        const [key, value, ttlMs] = args as [string, string, number];
        const existing = this.store.get(key);
        if (existing && existing.expiresAt > Date.now()) return 0;
        this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
        return 1;
      });
    } else if (name === 'dlqLockRelease') {
      this.commands.set('dlqLockRelease', (args) => {
        const [key, value] = args as [string, string];
        const existing = this.store.get(key);
        if (existing && existing.value === value) {
          this.store.delete(key);
          return 1;
        }
        return 0;
      });
    }
  }

  async runCommand(name: string, args: unknown[]): Promise<number> {
    const fn = this.commands.get(name);
    if (!fn) throw new Error(`command ${name} not defined`);
    return fn(args);
  }
}

class FakeQueue {
  private jobs = new Map<string, FakeJob>();
  private insertionOrder: string[] = [];
  private nextId = 1;
  readonly sharedClient: FakeRedisClient;

  constructor(sharedClient?: FakeRedisClient) {
    this.sharedClient = sharedClient ?? new FakeRedisClient();
  }

  get client(): Promise<FakeRedisClient> {
    return Promise.resolve(this.sharedClient);
  }

  async add(name: string, data: unknown, _opts?: unknown): Promise<FakeJob> {
    const id = String(this.nextId++);
    const job = new FakeJob(id, name, data, 'waiting');
    this.jobs.set(id, job);
    this.insertionOrder.push(id);
    return job;
  }

  /** Test helper: seed a job with a specific id/state, bypassing add(). */
  seed(
    id: string,
    name: string,
    data: unknown,
    state: FakeJobState = 'failed',
  ): FakeJob {
    const job = new FakeJob(id, name, data, state);
    this.jobs.set(id, job);
    this.insertionOrder.push(id);
    return job;
  }

  async getJob(id: string): Promise<FakeJob | undefined> {
    return this.jobs.get(id);
  }

  async getJobs(
    types: FakeJobState[],
    start = 0,
    end = -1,
    _asc = true,
  ): Promise<FakeJob[]> {
    const matching = this.insertionOrder
      .map((id) => this.jobs.get(id)!)
      .filter((job) => types.includes(job.state));
    const stop = end === -1 ? matching.length - 1 : end;
    return matching.slice(start, stop + 1);
  }

  async removeJob(id: string): Promise<void> {
    this.jobs.delete(id);
    this.insertionOrder = this.insertionOrder.filter(
      (existing) => existing !== id,
    );
  }
}

function buildService(): {
  service: DeadLetterService;
  dlq: FakeQueue;
  oracleQueue: FakeQueue;
  ipfsQueue: FakeQueue;
  notificationsQueue: FakeQueue;
} {
  const dlq = new FakeQueue();
  const oracleQueue = new FakeQueue();
  const ipfsQueue = new FakeQueue();
  const notificationsQueue = new FakeQueue();

  // Wire real job.remove() to actually remove from the owning queue.
  const wireRemove = (queue: FakeQueue) => {
    const originalGetJobs = queue.getJobs.bind(queue);
    queue.getJobs = async (...args: Parameters<FakeQueue['getJobs']>) => {
      const jobs = await originalGetJobs(...args);
      for (const job of jobs) {
        job.remove = async () => {
          await queue.removeJob(job.id);
        };
      }
      return jobs;
    };
  };
  wireRemove(dlq);

  const service = new DeadLetterService(
    dlq as unknown as never,
    oracleQueue as unknown as never,
    ipfsQueue as unknown as never,
    notificationsQueue as unknown as never,
  );

  return { service, dlq, oracleQueue, ipfsQueue, notificationsQueue };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DeadLetterService', () => {
  describe('isFinalAttempt', () => {
    it('treats attemptsMade >= attempts as final attempt', () => {
      const { service } = buildService();

      expect(
        service.isFinalAttempt({
          attemptsMade: 1,
          opts: { attempts: 1 },
        } as any),
      ).toBe(true);
      expect(
        service.isFinalAttempt({
          attemptsMade: 2,
          opts: { attempts: 3 },
        } as any),
      ).toBe(false);
      expect(
        service.isFinalAttempt({
          attemptsMade: 3,
          opts: { attempts: 3 },
        } as any),
      ).toBe(true);
    });
  });

  describe('moveToDeadLetter', () => {
    it('redacts job data and classifies the failure', async () => {
      const { service, dlq } = buildService();
      const job = {
        id: '7',
        name: 'sign',
        data: {
          payload: { asset: 'XLM', price: '0.12', timestamp: Date.now() },
        },
        attemptsMade: 5,
        opts: { attempts: 5 },
        timestamp: Date.now(),
        failedReason: 'connect ECONNREFUSED 127.0.0.1:443',
        stacktrace: ['at signPrice (/app/oracle.ts:10:1)'],
      } as any;

      await service.moveToDeadLetter(
        QUEUE_ORACLE_SIGNING,
        job,
        new Error('ECONNREFUSED'),
      );

      const stored = await dlq.getJobs(['waiting']);
      expect(stored).toHaveLength(1);
      const payload = stored[0].data as DeadLetterPayload;
      expect(payload.data).toEqual({
        payload: {
          asset: 'XLM',
          price: '0.12',
          timestamp: job.data.payload.timestamp,
        },
      });
      expect(payload.classification).toBe(
        DeadLetterClassification.RETRYABLE_INFRASTRUCTURE,
      );
      expect(payload.replayStatus).toBe(ReplayStatus.OPEN);
      expect(payload.redactionFailed).toBe(false);
    });

    it('marks redactionFailed and stores an empty stub when data does not match the queue shape', async () => {
      const { service, dlq } = buildService();
      const job = {
        id: '8',
        name: 'pin',
        data: { unexpected: 'shape' },
        attemptsMade: 3,
        opts: { attempts: 3 },
        timestamp: Date.now(),
      } as any;

      await service.moveToDeadLetter(QUEUE_IPFS_PINNING, job, undefined);

      const stored = await dlq.getJobs(['waiting']);
      const payload = stored[0].data as DeadLetterPayload;
      expect(payload.redactionFailed).toBe(true);
      expect(payload.data).toEqual({});
      expect(payload.classification).toBe(DeadLetterClassification.UNKNOWN);
    });
  });

  describe('legacy entries', () => {
    it('backfills defaults for entries stored before these fields existed', async () => {
      const { service, dlq } = buildService();
      const legacyPayload = {
        sourceQueue: QUEUE_NOTIFICATIONS,
        jobName: 'dispatch',
        jobId: '42',
        attemptsMade: 3,
        attempts: 3,
        data: { notificationId: 42 },
        movedAt: new Date('2026-01-01').toISOString(),
        // no version, correlationId, classification, replayStatus, sourceTimestamp
      } as DeadLetterPayload;

      const legacyJob = await dlq.add('dead-letter', legacyPayload);

      const entry = await service.getEntry(legacyJob.id);
      expect(entry).not.toBeNull();
      expect(entry!.version).toBe(0);
      expect(entry!.classification).toBe(DeadLetterClassification.UNKNOWN);
      expect(entry!.replayStatus).toBe(ReplayStatus.OPEN);
      expect(entry!.correlationId).toBe(`legacy-${legacyJob.id}`);
      expect(entry!.sourceTimestamp).toBe(legacyPayload.movedAt);
    });
  });

  describe('listEntries', () => {
    it('paginates with a cursor and applies filters', async () => {
      const { service, dlq } = buildService();

      for (let i = 0; i < 5; i++) {
        await dlq.add('dead-letter', {
          version: 1,
          correlationId: `c${i}`,
          sourceQueue: i % 2 === 0 ? QUEUE_ORACLE_SIGNING : QUEUE_IPFS_PINNING,
          jobName: 'job',
          jobId: String(i),
          attemptsMade: 3,
          attempts: 3,
          data: {},
          redactionFailed: false,
          sourceTimestamp: new Date().toISOString(),
          movedAt: new Date().toISOString(),
          replayStatus: ReplayStatus.OPEN,
          classification: DeadLetterClassification.PERMANENT_VALIDATION,
        } satisfies DeadLetterPayload);
      }

      const page1 = await service.listEntries({
        limit: 2,
        sourceQueue: QUEUE_ORACLE_SIGNING,
      });
      expect(page1.entries).toHaveLength(2);
      expect(
        page1.entries.every((e) => e.sourceQueue === QUEUE_ORACLE_SIGNING),
      ).toBe(true);

      const allOracle = await service.listEntries({
        limit: 10,
        sourceQueue: QUEUE_ORACLE_SIGNING,
      });
      expect(allOracle.entries).toHaveLength(3);
    });
  });

  describe('replayEntry', () => {
    it('replays successfully when the source job is failed and schema-valid', async () => {
      const { service, dlq, oracleQueue } = buildService();

      oracleQueue.seed(
        '100',
        'sign',
        { payload: { asset: 'XLM', price: '0.12', timestamp: Date.now() } },
        'failed',
      );

      const dlqJob = await dlq.add('dead-letter', {
        version: 1,
        correlationId: 'c1',
        sourceQueue: QUEUE_ORACLE_SIGNING,
        jobName: 'sign',
        jobId: '100',
        attemptsMade: 3,
        attempts: 3,
        data: {},
        redactionFailed: false,
        sourceTimestamp: new Date().toISOString(),
        movedAt: new Date().toISOString(),
        replayStatus: ReplayStatus.OPEN,
        classification: DeadLetterClassification.RETRYABLE_INFRASTRUCTURE,
      } satisfies DeadLetterPayload);

      const result = await service.replayEntry(
        dlqJob.id,
        'operator-1',
        'infra recovered',
      );

      expect(result.outcome).toBe('replayed');
      if (result.outcome === 'replayed') {
        expect(result.entry.replayStatus).toBe(ReplayStatus.REPLAYED);
        expect(result.entry.replayedBy).toBe('operator-1');
      }
      const sourceJob = await oracleQueue.getJob('100');
      expect(sourceJob!.state).toBe('waiting');
    });

    it('rejects replay when the source job no longer exists', async () => {
      const { service, dlq } = buildService();

      const dlqJob = await dlq.add('dead-letter', {
        version: 1,
        correlationId: 'c2',
        sourceQueue: QUEUE_ORACLE_SIGNING,
        jobName: 'sign',
        jobId: '999',
        attemptsMade: 3,
        attempts: 3,
        data: {},
        redactionFailed: false,
        sourceTimestamp: new Date().toISOString(),
        movedAt: new Date().toISOString(),
        replayStatus: ReplayStatus.OPEN,
        classification: DeadLetterClassification.PERMANENT_VALIDATION,
      } satisfies DeadLetterPayload);

      const result = await service.replayEntry(
        dlqJob.id,
        'operator-1',
        'trying anyway',
      );

      expect(result.outcome).toBe('rejected');
      if (result.outcome === 'rejected') {
        expect(result.reason).toMatch(/no longer exists/);
      }
    });

    it('rejects replay when the source job fails current schema validation', async () => {
      const { service, dlq, oracleQueue } = buildService();

      oracleQueue.seed('101', 'sign', { payload: { asset: 'XLM' } }, 'failed'); // missing price/timestamp

      const dlqJob = await dlq.add('dead-letter', {
        version: 1,
        correlationId: 'c3',
        sourceQueue: QUEUE_ORACLE_SIGNING,
        jobName: 'sign',
        jobId: '101',
        attemptsMade: 3,
        attempts: 3,
        data: {},
        redactionFailed: false,
        sourceTimestamp: new Date().toISOString(),
        movedAt: new Date().toISOString(),
        replayStatus: ReplayStatus.OPEN,
        classification: DeadLetterClassification.PERMANENT_VALIDATION,
      } satisfies DeadLetterPayload);

      const result = await service.replayEntry(
        dlqJob.id,
        'operator-1',
        'attempt',
      );

      expect(result.outcome).toBe('rejected');
      if (result.outcome === 'rejected') {
        expect(result.reason).toMatch(/schema validation/);
      }
    });

    it('rejects unknown queue/job combinations for unsupported source queues', async () => {
      const { service, dlq } = buildService();

      const dlqJob = await dlq.add('dead-letter', {
        version: 1,
        correlationId: 'c4',
        sourceQueue: 'reconciliation' as never,
        jobName: 'reconcile',
        jobId: '1',
        attemptsMade: 3,
        attempts: 3,
        data: {},
        redactionFailed: false,
        sourceTimestamp: new Date().toISOString(),
        movedAt: new Date().toISOString(),
        replayStatus: ReplayStatus.OPEN,
        classification: DeadLetterClassification.PERMANENT_VALIDATION,
      } satisfies DeadLetterPayload);

      const result = await service.replayEntry(
        dlqJob.id,
        'operator-1',
        'attempt',
      );

      expect(result.outcome).toBe('rejected');
      if (result.outcome === 'rejected') {
        expect(result.reason).toMatch(/not supported/);
      }
    });

    it('allows only one of two concurrent replay requests to succeed', async () => {
      const { service, dlq, oracleQueue } = buildService();

      oracleQueue.seed(
        '102',
        'sign',
        { payload: { asset: 'XLM', price: '0.12', timestamp: Date.now() } },
        'failed',
      );

      const dlqJob = await dlq.add('dead-letter', {
        version: 1,
        correlationId: 'c5',
        sourceQueue: QUEUE_ORACLE_SIGNING,
        jobName: 'sign',
        jobId: '102',
        attemptsMade: 3,
        attempts: 3,
        data: {},
        redactionFailed: false,
        sourceTimestamp: new Date().toISOString(),
        movedAt: new Date().toISOString(),
        replayStatus: ReplayStatus.OPEN,
        classification: DeadLetterClassification.RETRYABLE_INFRASTRUCTURE,
      } satisfies DeadLetterPayload);

      const [resultA, resultB] = await Promise.all([
        service.replayEntry(dlqJob.id, 'operator-1', 'first'),
        service.replayEntry(dlqJob.id, 'operator-2', 'second'),
      ]);

      const outcomes = [resultA.outcome, resultB.outcome].sort();
      expect(outcomes).toEqual(['rejected', 'replayed']);
    });
  });

  describe('dismissEntry', () => {
    it('dismisses an open entry with actor and reason', async () => {
      const { service, dlq } = buildService();

      const dlqJob = await dlq.add('dead-letter', {
        version: 1,
        correlationId: 'c6',
        sourceQueue: QUEUE_NOTIFICATIONS,
        jobName: 'dispatch',
        jobId: '1',
        attemptsMade: 3,
        attempts: 3,
        data: { notificationId: 1 },
        redactionFailed: false,
        sourceTimestamp: new Date().toISOString(),
        movedAt: new Date().toISOString(),
        replayStatus: ReplayStatus.OPEN,
        classification: DeadLetterClassification.PERMANENT_VALIDATION,
      } satisfies DeadLetterPayload);

      const result = await service.dismissEntry(
        dlqJob.id,
        'operator-1',
        'known duplicate, ignoring',
      );

      expect(result.outcome).toBe('dismissed');
      if (result.outcome === 'dismissed') {
        expect(result.entry.dismissedBy).toBe('operator-1');
        expect(result.entry.dismissReason).toBe('known duplicate, ignoring');
      }
    });

    it('rejects dismissing an already-terminal entry', async () => {
      const { service, dlq } = buildService();

      const dlqJob = await dlq.add('dead-letter', {
        version: 1,
        correlationId: 'c7',
        sourceQueue: QUEUE_NOTIFICATIONS,
        jobName: 'dispatch',
        jobId: '2',
        attemptsMade: 3,
        attempts: 3,
        data: { notificationId: 2 },
        redactionFailed: false,
        sourceTimestamp: new Date().toISOString(),
        movedAt: new Date().toISOString(),
        replayStatus: ReplayStatus.DISMISSED,
        classification: DeadLetterClassification.PERMANENT_VALIDATION,
        dismissedAt: new Date().toISOString(),
        dismissedBy: 'operator-0',
        dismissReason: 'already handled',
      } satisfies DeadLetterPayload);

      const result = await service.dismissEntry(
        dlqJob.id,
        'operator-1',
        'trying again',
      );

      expect(result.outcome).toBe('rejected');
    });
  });

  describe('cleanupExpiredEntries', () => {
    it('removes replayed/dismissed entries past retention but keeps open entries', async () => {
      const { service, dlq } = buildService();
      const longAgo = new Date(
        Date.now() - 40 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const recent = new Date().toISOString();

      const oldReplayed = await dlq.add('dead-letter', {
        version: 1,
        correlationId: 'r1',
        sourceQueue: QUEUE_NOTIFICATIONS,
        jobName: 'dispatch',
        jobId: '10',
        attemptsMade: 3,
        attempts: 3,
        data: {},
        redactionFailed: false,
        sourceTimestamp: longAgo,
        movedAt: longAgo,
        replayStatus: ReplayStatus.REPLAYED,
        replayedAt: longAgo,
        classification: DeadLetterClassification.RETRYABLE_INFRASTRUCTURE,
      } satisfies DeadLetterPayload);

      const openEntry = await dlq.add('dead-letter', {
        version: 1,
        correlationId: 'r2',
        sourceQueue: QUEUE_NOTIFICATIONS,
        jobName: 'dispatch',
        jobId: '11',
        attemptsMade: 3,
        attempts: 3,
        data: {},
        redactionFailed: false,
        sourceTimestamp: longAgo,
        movedAt: longAgo,
        replayStatus: ReplayStatus.OPEN,
        classification: DeadLetterClassification.PERMANENT_VALIDATION,
      } satisfies DeadLetterPayload);

      const recentDismissed = await dlq.add('dead-letter', {
        version: 1,
        correlationId: 'r3',
        sourceQueue: QUEUE_NOTIFICATIONS,
        jobName: 'dispatch',
        jobId: '12',
        attemptsMade: 3,
        attempts: 3,
        data: {},
        redactionFailed: false,
        sourceTimestamp: recent,
        movedAt: recent,
        replayStatus: ReplayStatus.DISMISSED,
        dismissedAt: recent,
        classification: DeadLetterClassification.PERMANENT_VALIDATION,
      } satisfies DeadLetterPayload);

      await service.cleanupExpiredEntries();

      expect(await dlq.getJob(oldReplayed.id)).toBeUndefined();
      expect(await dlq.getJob(openEntry.id)).toBeDefined();
      expect(await dlq.getJob(recentDismissed.id)).toBeDefined();
    });
  });
});
