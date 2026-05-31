import { Retryable } from './retryable.decorator';

jest.useFakeTimers();

class TestService {
  callCount = 0;

  @Retryable(3, 100)
  async flakyMethod(failTimes: number): Promise<string> {
    this.callCount++;
    if (this.callCount <= failTimes) throw new Error(`fail #${this.callCount}`);
    return 'success';
  }

  @Retryable(2, 100)
  async alwaysFails(): Promise<void> {
    throw new Error('always fails');
  }
}

describe('Retryable', () => {
  beforeEach(() => jest.clearAllTimers());

  it('returns result on first try', async () => {
    const svc = new TestService();
    const p = svc.flakyMethod(0);
    jest.runAllTimers();
    await expect(p).resolves.toBe('success');
    expect(svc.callCount).toBe(1);
  });

  it('retries and succeeds after failures', async () => {
    const svc = new TestService();
    const p = svc.flakyMethod(2);
    jest.runAllTimers();
    await expect(p).resolves.toBe('success');
    expect(svc.callCount).toBe(3);
  });

  it('throws after all retries exhausted', async () => {
    const svc = new TestService();
    const p = svc.alwaysFails();
    jest.runAllTimers();
    await expect(p).rejects.toThrow('always fails');
  });
});
