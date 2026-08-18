import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { WebhookService } from './webhook.service';
import { WebhookSubscription, WebhookDeliveryLog } from './webhook.entity';
import { WebhookEventType } from './webhook-event-type.enum';
import { SubscribeWebhookDto } from './webhook.dto';
import { QUEUE_WEBHOOK_DISPATCH } from './webhook-queue.constants';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockSub: WebhookSubscription = {
  id: 'sub-uuid-1',
  userAddress: 'GADDR1',
  url: 'https://example.com/hook',
  secret: 'supersecretkey1234',
  events: [WebhookEventType.CALL_CREATED, WebhookEventType.CALL_RESOLVED],
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

// ─── Mock providers ───────────────────────────────────────────────────────────

const subRepoMock = {
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
};

const logRepoMock = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  count: jest.fn(),
};

const dispatchQueueMock = {
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
};

const httpServiceMock = {
  post: jest.fn(),
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('WebhookService', () => {
  let service: WebhookService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        {
          provide: getRepositoryToken(WebhookSubscription),
          useValue: subRepoMock,
        },
        {
          provide: getRepositoryToken(WebhookDeliveryLog),
          useValue: logRepoMock,
        },
        {
          provide: getQueueToken(QUEUE_WEBHOOK_DISPATCH),
          useValue: dispatchQueueMock,
        },
        { provide: HttpService, useValue: httpServiceMock },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
  });

  // ─── subscribe ─────────────────────────────────────────────────────────────

  describe('subscribe()', () => {
    const dto: SubscribeWebhookDto = {
      url: 'https://hooks.example.com/events',
      secret: 'my-signing-secret-16',
      events: [WebhookEventType.CALL_CREATED],
    };

    it('creates and saves a new subscription', async () => {
      subRepoMock.create.mockReturnValue(mockSub);
      subRepoMock.save.mockResolvedValue(mockSub);
      logRepoMock.count.mockResolvedValue(0);

      const result = await service.subscribe('GADDR1', dto);

      expect(subRepoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ userAddress: 'GADDR1', url: dto.url }),
      );
      expect(subRepoMock.save).toHaveBeenCalledWith(mockSub);
      expect(result.id).toBe(mockSub.id);
    });

    it('does NOT expose the secret in the response DTO', async () => {
      subRepoMock.create.mockReturnValue(mockSub);
      subRepoMock.save.mockResolvedValue(mockSub);
      logRepoMock.count.mockResolvedValue(0);

      const result = await service.subscribe('GADDR1', dto);

      expect((result as any).secret).toBeUndefined();
    });
  });

  // ─── unsubscribe ───────────────────────────────────────────────────────────

  describe('unsubscribe()', () => {
    it('removes the subscription for the owner', async () => {
      subRepoMock.findOne.mockResolvedValue(mockSub);
      await service.unsubscribe('GADDR1', 'sub-uuid-1');
      expect(subRepoMock.remove).toHaveBeenCalledWith(mockSub);
    });

    it('throws NotFoundException when subscription does not exist', async () => {
      subRepoMock.findOne.mockResolvedValue(null);
      await expect(
        service.unsubscribe('GADDR1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user does not own the subscription', async () => {
      subRepoMock.findOne.mockResolvedValue({
        ...mockSub,
        userAddress: 'OTHER',
      });
      await expect(service.unsubscribe('GADDR1', 'sub-uuid-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ─── listSubscriptions ─────────────────────────────────────────────────────

  describe('listSubscriptions()', () => {
    it('returns subscriptions with delivery stats', async () => {
      subRepoMock.find.mockResolvedValue([mockSub]);
      logRepoMock.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8); // success

      const result = await service.listSubscriptions('GADDR1');

      expect(result).toHaveLength(1);
      expect(result[0].totalDeliveries).toBe(10);
      expect(result[0].successfulDeliveries).toBe(8);
    });

    it('returns empty array when user has no subscriptions', async () => {
      subRepoMock.find.mockResolvedValue([]);
      const result = await service.listSubscriptions('GADDR1');
      expect(result).toEqual([]);
    });
  });

  // ─── HMAC signing ──────────────────────────────────────────────────────────

  describe('WebhookService.signPayload()', () => {
    it('returns a 64-char hex string (SHA-256)', () => {
      const sig = WebhookService.signPayload('{"event":"test"}', 'secret123');
      expect(sig).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces different signatures for different secrets', () => {
      const body = '{"event":"call.created"}';
      const sig1 = WebhookService.signPayload(body, 'secret-a');
      const sig2 = WebhookService.signPayload(body, 'secret-b');
      expect(sig1).not.toBe(sig2);
    });

    it('is deterministic for the same input', () => {
      const body = '{"event":"call.resolved"}';
      expect(WebhookService.signPayload(body, 'mykey')).toBe(
        WebhookService.signPayload(body, 'mykey'),
      );
    });

    it('matches native crypto.createHmac output', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const crypto = require('crypto');
      const body = '{"event":"stake.placed"}';
      const secret = 'verify-test-secret';
      const expected = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      expect(WebhookService.signPayload(body, secret)).toBe(expected);
    });
  });

  describe('buildPayload()', () => {
    it('includes event, timestamp, data, and signature', () => {
      const payload = service.buildPayload(
        WebhookEventType.CALL_CREATED,
        { callId: 42 },
        'my-secret-key-abc',
      );
      expect(payload.event).toBe(WebhookEventType.CALL_CREATED);
      expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(payload.data).toEqual({ callId: 42 });
      expect(payload.signature).toHaveLength(64);
    });
  });

  // ─── dispatchEvent ─────────────────────────────────────────────────────────

  describe('dispatchEvent()', () => {
    it('enqueues one job per matching active subscriber', async () => {
      const sub2: WebhookSubscription = {
        ...mockSub,
        id: 'sub-2',
        events: [WebhookEventType.CALL_RESOLVED],
      };
      subRepoMock.find.mockResolvedValue([mockSub, sub2]);

      await service.dispatchEvent(WebhookEventType.CALL_CREATED, {
        callId: 1,
      });

      // Only mockSub subscribes to CALL_CREATED
      expect(dispatchQueueMock.add).toHaveBeenCalledTimes(1);
      expect(dispatchQueueMock.add).toHaveBeenCalledWith(
        'dispatch',
        expect.objectContaining({
          subscriptionId: 'sub-uuid-1',
          event: WebhookEventType.CALL_CREATED,
        }),
        expect.any(Object),
      );
    });

    it('enqueues jobs for all subscribers that match', async () => {
      const sub2: WebhookSubscription = {
        ...mockSub,
        id: 'sub-2',
        events: [WebhookEventType.CALL_CREATED],
      };
      subRepoMock.find.mockResolvedValue([mockSub, sub2]);

      await service.dispatchEvent(WebhookEventType.CALL_CREATED, {});
      expect(dispatchQueueMock.add).toHaveBeenCalledTimes(2);
    });

    it('does nothing when no subscribers match the event', async () => {
      subRepoMock.find.mockResolvedValue([
        { ...mockSub, events: [WebhookEventType.LEADERBOARD_UPDATED] },
      ]);
      await service.dispatchEvent(WebhookEventType.CALL_CREATED, {});
      expect(dispatchQueueMock.add).not.toHaveBeenCalled();
    });

    it('does nothing when subscriber list is empty', async () => {
      subRepoMock.find.mockResolvedValue([]);
      await service.dispatchEvent(WebhookEventType.CALL_CREATED, {});
      expect(dispatchQueueMock.add).not.toHaveBeenCalled();
    });
  });

  // ─── sendTestPing ──────────────────────────────────────────────────────────

  describe('sendTestPing()', () => {
    it('returns success=true when target URL responds 200', async () => {
      subRepoMock.findOne.mockResolvedValue(mockSub);
      httpServiceMock.post.mockReturnValue(of({ status: 200, data: 'ok' }));

      const result = await service.sendTestPing('GADDR1', 'sub-uuid-1');

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.error).toBeNull();
    });

    it('returns success=false when HTTP call fails', async () => {
      subRepoMock.findOne.mockResolvedValue(mockSub);
      httpServiceMock.post.mockReturnValue(
        throwError(() =>
          Object.assign(new Error('ECONNREFUSED'), {
            response: { status: 503 },
          }),
        ),
      );

      const result = await service.sendTestPing('GADDR1', 'sub-uuid-1');

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(503);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('throws NotFoundException for unknown subscription', async () => {
      subRepoMock.findOne.mockResolvedValue(null);
      await expect(service.sendTestPing('GADDR1', 'bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException for subscription owned by another user', async () => {
      subRepoMock.findOne.mockResolvedValue({
        ...mockSub,
        userAddress: 'OTHER',
      });
      await expect(
        service.sendTestPing('GADDR1', 'sub-uuid-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── recordDelivery ────────────────────────────────────────────────────────

  describe('recordDelivery()', () => {
    it('saves a delivery log entry with correct fields', async () => {
      const logEntry = { id: 'log-1' };
      logRepoMock.create.mockReturnValue(logEntry);
      logRepoMock.save.mockResolvedValue(logEntry);

      await service.recordDelivery(
        'sub-1',
        'call.created',
        '{}',
        true,
        200,
        null,
        1,
      );

      expect(logRepoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub-1',
          eventType: 'call.created',
          success: true,
          statusCode: 200,
          errorMessage: null,
          attempt: 1,
        }),
      );
      expect(logRepoMock.save).toHaveBeenCalledWith(logEntry);
    });

    it('records failed delivery with error message', async () => {
      const logEntry = { id: 'log-2' };
      logRepoMock.create.mockReturnValue(logEntry);
      logRepoMock.save.mockResolvedValue(logEntry);

      await service.recordDelivery(
        'sub-1',
        'stake.placed',
        '{}',
        false,
        500,
        'Internal Server Error',
        3,
      );

      expect(logRepoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          statusCode: 500,
          errorMessage: 'Internal Server Error',
          attempt: 3,
        }),
      );
    });
  });

  // ─── getDeliveryLogs ───────────────────────────────────────────────────────

  describe('getDeliveryLogs()', () => {
    it('returns mapped delivery log DTOs', async () => {
      subRepoMock.findOne.mockResolvedValue(mockSub);
      const mockLog: WebhookDeliveryLog = {
        id: 'log-uuid-1',
        subscriptionId: 'sub-uuid-1',
        eventType: 'call.created',
        payload: '{}',
        success: true,
        statusCode: 200,
        errorMessage: null,
        attempt: 1,
        createdAt: new Date(),
      };
      logRepoMock.find.mockResolvedValue([mockLog]);

      const result = await service.getDeliveryLogs('GADDR1', 'sub-uuid-1');

      expect(result).toHaveLength(1);
      expect(result[0].eventType).toBe('call.created');
      expect(result[0].success).toBe(true);
      // payload field should NOT be exposed
      expect((result[0] as any).payload).toBeUndefined();
    });

    it('throws ForbiddenException if user does not own the subscription', async () => {
      subRepoMock.findOne.mockResolvedValue({
        ...mockSub,
        userAddress: 'OTHER',
      });
      await expect(
        service.getDeliveryLogs('GADDR1', 'sub-uuid-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
