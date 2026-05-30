import { NotificationsQueueProcessor } from './notifications.queue.processor';
import { QUEUE_NOTIFICATIONS } from '../../common/queues/queues.constants';

describe('NotificationsQueueProcessor', () => {
  it('moves permanently failed jobs to dead-letter queue', async () => {
    const deadLetter = {
      isFinalAttempt: jest.fn().mockReturnValue(true),
      moveToDeadLetter: jest.fn().mockResolvedValue(undefined),
    };

    const processor = new NotificationsQueueProcessor(
      {} as any,
      {} as any,
      {} as any,
      deadLetter as any,
    );

    const job: any = {
      name: 'dispatch-notification',
      id: '1',
      data: { notificationId: 1 },
      attemptsMade: 5,
      opts: { attempts: 5 },
    };

    await processor.onFailed(job, new Error('boom'));

    expect(deadLetter.isFinalAttempt).toHaveBeenCalledWith(job);
    expect(deadLetter.moveToDeadLetter).toHaveBeenCalledWith(
      QUEUE_NOTIFICATIONS,
      job,
    );
  });

  it('does not move non-final failures to dead-letter queue', async () => {
    const deadLetter = {
      isFinalAttempt: jest.fn().mockReturnValue(false),
      moveToDeadLetter: jest.fn(),
    };

    const processor = new NotificationsQueueProcessor(
      {} as any,
      {} as any,
      {} as any,
      deadLetter as any,
    );

    const job: any = {
      data: { notificationId: 1 },
      attemptsMade: 2,
      opts: { attempts: 5 },
    };

    await processor.onFailed(job, new Error('boom'));
    expect(deadLetter.moveToDeadLetter).not.toHaveBeenCalled();
  });
});

