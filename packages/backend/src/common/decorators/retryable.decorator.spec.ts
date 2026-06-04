/* eslint-disable @typescript-eslint/require-await */
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
  beforeEach(() => {
    jest.clearAllTimers();
  });

  it('returns result on first try', async () => {
    const svc = new TestService();
    const p = svc.flakyMethod(0);
    await jest.runAllTimersAsync();
    await expect(p).resolves.toBe('success');
    expect(svc.callCount).toBe(1);
  });

  it('retries and succeeds after failures', async () => {
    const svc = new TestService();
    const p = svc.flakyMethod(2);
    await jest.runAllTimersAsync();
    await expect(p).resolves.toBe('success');
    expect(svc.callCount).toBe(3);
  });

  it('throws after all retries exhausted', async () => {
    const svc = new TestService();
    // Attach catch before running timers to avoid unhandled rejection warning
    const caught = svc.alwaysFails().catch((e: unknown) => e);
    await jest.runAllTimersAsync();
    const result = await caught;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('always fails');
  });
});
