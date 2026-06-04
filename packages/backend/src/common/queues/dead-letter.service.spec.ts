import { DeadLetterService } from './dead-letter.service';

describe('DeadLetterService', () => {
  it('treats attemptsMade >= attempts as final attempt', () => {
    const service = new DeadLetterService({ add: jest.fn() } as any);

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
