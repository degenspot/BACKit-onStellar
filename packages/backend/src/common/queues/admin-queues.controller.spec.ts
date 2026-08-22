import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AdminQueuesController } from './admin-queues.controller';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { QUEUE_ORACLE_SIGNING } from './queues.constants';
import { ReplayStatus } from './dead-letter.service';
import { DeadLetterClassification } from './dead-letter-classification.enum';

const mockStatusService = { getStatus: jest.fn() };

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    dlqJobId: '1',
    version: 1,
    correlationId: 'c1',
    sourceQueue: QUEUE_ORACLE_SIGNING,
    jobName: 'sign',
    jobId: '100',
    attemptsMade: 3,
    attempts: 3,
    classification: DeadLetterClassification.RETRYABLE_INFRASTRUCTURE,
    data: {},
    redactionFailed: false,
    sourceTimestamp: new Date().toISOString(),
    movedAt: new Date().toISOString(),
    replayStatus: ReplayStatus.OPEN,
    ...overrides,
  };
}

describe('AdminQueuesController', () => {
  describe('guard wiring', () => {
    it('applies AdminGuard to the controller', () => {
      const guards =
        Reflect.getMetadata(GUARDS_METADATA, AdminQueuesController) ?? [];
      expect(guards).toContain(AdminGuard);
    });
  });

  describe('handlers', () => {
    let controller: AdminQueuesController;
    let deadLetterService: {
      listEntries: jest.Mock;
      getEntry: jest.Mock;
      replayEntry: jest.Mock;
      dismissEntry: jest.Mock;
    };

    beforeEach(() => {
      deadLetterService = {
        listEntries: jest.fn(),
        getEntry: jest.fn(),
        replayEntry: jest.fn(),
        dismissEntry: jest.fn(),
      };
      controller = new AdminQueuesController(
        mockStatusService as any,
        deadLetterService as any,
      );
    });

    it('getStatus delegates to QueuesStatusService', () => {
      mockStatusService.getStatus.mockReturnValue({ queues: [] });
      expect(controller.getStatus()).toEqual({ queues: [] });
    });

    it('listDeadLetterEntries delegates to the service with the query', async () => {
      deadLetterService.listEntries.mockResolvedValue({
        entries: [],
        nextCursor: null,
      });
      await controller.listDeadLetterEntries({ limit: 10 } as any);
      expect(deadLetterService.listEntries).toHaveBeenCalledWith({ limit: 10 });
    });

    it('getDeadLetterEntry returns the entry when found', async () => {
      const entry = makeEntry();
      deadLetterService.getEntry.mockResolvedValue(entry);
      await expect(controller.getDeadLetterEntry('1')).resolves.toEqual(entry);
    });

    it('getDeadLetterEntry throws NotFoundException when missing', async () => {
      deadLetterService.getEntry.mockResolvedValue(null);
      await expect(controller.getDeadLetterEntry('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('replayDeadLetterEntry returns the entry on success', async () => {
      const entry = makeEntry({ replayStatus: ReplayStatus.REPLAYED });
      deadLetterService.replayEntry.mockResolvedValue({
        outcome: 'replayed',
        entry,
      });

      const result = await controller.replayDeadLetterEntry(
        '1',
        { reason: 'infra recovered' },
        'operator-1',
      );

      expect(deadLetterService.replayEntry).toHaveBeenCalledWith(
        '1',
        'operator-1',
        'infra recovered',
      );
      expect(result).toEqual(entry);
    });

    it('replayDeadLetterEntry maps a "not found" rejection to NotFoundException', async () => {
      deadLetterService.replayEntry.mockResolvedValue({
        outcome: 'rejected',
        reason: 'dead-letter entry not found',
      });

      await expect(
        controller.replayDeadLetterEntry(
          '1',
          { reason: 'attempt' },
          'operator-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('replayDeadLetterEntry maps a schema-validation rejection to UnprocessableEntityException', async () => {
      deadLetterService.replayEntry.mockResolvedValue({
        outcome: 'rejected',
        reason: 'source job failed schema validation: bad shape',
      });

      await expect(
        controller.replayDeadLetterEntry(
          '1',
          { reason: 'attempt' },
          'operator-1',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('replayDeadLetterEntry maps a state-conflict rejection to ConflictException', async () => {
      deadLetterService.replayEntry.mockResolvedValue({
        outcome: 'rejected',
        reason: 'entry is already replayed',
      });

      await expect(
        controller.replayDeadLetterEntry(
          '1',
          { reason: 'attempt' },
          'operator-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('dismissDeadLetterEntry returns the entry on success', async () => {
      const entry = makeEntry({ replayStatus: ReplayStatus.DISMISSED });
      deadLetterService.dismissEntry.mockResolvedValue({
        outcome: 'dismissed',
        entry,
      });

      const result = await controller.dismissDeadLetterEntry(
        '1',
        { reason: 'known duplicate' },
        'operator-1',
      );

      expect(deadLetterService.dismissEntry).toHaveBeenCalledWith(
        '1',
        'operator-1',
        'known duplicate',
      );
      expect(result).toEqual(entry);
    });

    it('dismissDeadLetterEntry maps a rejection to ConflictException', async () => {
      deadLetterService.dismissEntry.mockResolvedValue({
        outcome: 'rejected',
        reason: 'entry is already dismissed',
      });

      await expect(
        controller.dismissDeadLetterEntry(
          '1',
          { reason: 'attempt' },
          'operator-1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
