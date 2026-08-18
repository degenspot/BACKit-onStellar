import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { Job } from 'bullmq';
import { WebhookDispatchProcessor } from './webhook-dispatch.processor';
import { WebhookService } from './webhook.service';
import { WebhookEventType } from './webhook-event-type.enum';
import { WebhookSubscription } from './webhook.entity';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockSub: WebhookSubscription = {
  id: 'sub-1',
  userAddress: 'GADDR1',
  url: 'https://receiver.example.com/hook',
  secret: 'secret-key-for-signing',
  events: [WebhookEventType.CALL_CREATED],
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    data: {
      subscriptionId: 'sub-1',
      event: WebhookEventType.CALL_CREATED,
      data: { callId: 42 },
    },
    attemptsMade: 0,
    ...overrides,
  } as unknown as Job;
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const webhookServiceMock = {
  findById: jest.fn(),
  buildPayload: jest.fn().mockReturnValue({
    event: WebhookEventType.CALL_CREATED,
    timestamp: '2026-08-17T10:00:00Z',
    data: { callId: 42 },
    signature: 'abc123',
  }),
  recordDelivery: jest.fn().mockResolvedValue(undefined),
};

const httpServiceMock = {
  post: jest.fn(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WebhookDispatchProcessor', () => {
  let processor: WebhookDispatchProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDispatchProcessor,
        { provide: WebhookService, useValue: webhookServiceMock },
        { provide: HttpService, useValue: httpServiceMock },
      ],
    }).compile();

    processor = module.get<WebhookDispatchProcessor>(WebhookDispatchProcessor);
  });

  it('POSTs payload and records successful delivery', async () => {
    webhookServiceMock.findById.mockResolvedValue(mockSub);
    httpServiceMock.post.mockReturnValue(of({ status: 200 }));

    await processor.process(makeJob());

    expect(httpServiceMock.post).toHaveBeenCalledWith(
      mockSub.url,
      expect.any(Object),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-BACKit-Signature': expect.any(String),
          'X-BACKit-Event': WebhookEventType.CALL_CREATED,
        }),
      }),
    );
    expect(webhookServiceMock.recordDelivery).toHaveBeenCalledWith(
      'sub-1',
      WebhookEventType.CALL_CREATED,
      expect.any(String),
      true,
      200,
      null,
      1,
    );
  });

  it('records failed delivery and re-throws on HTTP error', async () => {
    webhookServiceMock.findById.mockResolvedValue(mockSub);
    httpServiceMock.post.mockReturnValue(
      throwError(() =>
        Object.assign(new Error('timeout'), { response: { status: 504 } }),
      ),
    );

    await expect(processor.process(makeJob())).rejects.toThrow('timeout');

    expect(webhookServiceMock.recordDelivery).toHaveBeenCalledWith(
      'sub-1',
      WebhookEventType.CALL_CREATED,
      expect.any(String),
      false,
      504,
      'timeout',
      1,
    );
  });

  it('skips processing for inactive subscription', async () => {
    webhookServiceMock.findById.mockResolvedValue({
      ...mockSub,
      isActive: false,
    });

    await processor.process(makeJob());

    expect(httpServiceMock.post).not.toHaveBeenCalled();
    expect(webhookServiceMock.recordDelivery).not.toHaveBeenCalled();
  });

  it('skips processing when subscription not found', async () => {
    webhookServiceMock.findById.mockResolvedValue(null);

    await processor.process(makeJob());

    expect(httpServiceMock.post).not.toHaveBeenCalled();
  });

  it('throws when rate limit is exceeded', async () => {
    webhookServiceMock.findById.mockResolvedValue(mockSub);
    httpServiceMock.post.mockReturnValue(of({ status: 200 }));

    // Exhaust the 10 req/s rate limit by sending 10 successful jobs first
    for (let i = 0; i < 10; i++) {
      await processor.process(makeJob({ attemptsMade: i }));
    }

    // 11th should be rate-limited
    await expect(
      processor.process(makeJob({ attemptsMade: 10 })),
    ).rejects.toThrow(/Rate limit exceeded/);
  });
});
