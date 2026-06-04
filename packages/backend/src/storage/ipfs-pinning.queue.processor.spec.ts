import { IpfsPinningQueueProcessor } from './ipfs-pinning.queue.processor';
import { QUEUE_IPFS_PINNING } from '../common/queues/queues.constants';

describe('IpfsPinningQueueProcessor', () => {
  it('moves permanently failed jobs to dead-letter queue', async () => {
    const deadLetter = {
      isFinalAttempt: jest.fn().mockReturnValue(true),
      moveToDeadLetter: jest.fn().mockResolvedValue(undefined),
    };

    const processor = new IpfsPinningQueueProcessor(
      {} as any,
      deadLetter as any,
    );

    const job: any = {
      name: 'pin-call-content',
      id: '1',
      data: { type: 'call-content', content: { title: 't' } },
      attemptsMade: 5,
      opts: { attempts: 5 },
    };

    await processor.onFailed(job, new Error('boom'));

    expect(deadLetter.isFinalAttempt).toHaveBeenCalledWith(job);
    expect(deadLetter.moveToDeadLetter).toHaveBeenCalledWith(
      QUEUE_IPFS_PINNING,
      job,
    );
  });
});
