import { OracleSigningQueueProcessor } from './oracle-signing.queue.processor';
import { QUEUE_ORACLE_SIGNING } from '../common/queues/queues.constants';

describe('OracleSigningQueueProcessor', () => {
  it('moves permanently failed jobs to dead-letter queue', async () => {
    const deadLetter = {
      isFinalAttempt: jest.fn().mockReturnValue(true),
      moveToDeadLetter: jest.fn().mockResolvedValue(undefined),
    };

    const processor = new OracleSigningQueueProcessor(
      {} as any,
      deadLetter as any,
    );

    const job: any = {
      name: 'sign-price',
      id: '1',
      data: { payload: { asset: 'X', price: '1', timestamp: 1 } },
      attemptsMade: 3,
      opts: { attempts: 3 },
    };

    await processor.onFailed(job, new Error('boom'));

    expect(deadLetter.isFinalAttempt).toHaveBeenCalledWith(job);
    expect(deadLetter.moveToDeadLetter).toHaveBeenCalledWith(
      QUEUE_ORACLE_SIGNING,
      job,
    );
  });
});
