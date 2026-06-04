import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SelectQueryBuilder } from 'typeorm';
import { AdminService } from './admin.service';
import { Call, CallStatus } from '../calls/entities/call.entity';
import { CallReport } from '../calls/entities/call-report.entity';
import { Users } from '../user/entities/users.entity';

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeCall = (overrides: Partial<Call> = {}): Call =>
  ({
    id: 'call-uuid-1',
    title: 'Test Call',
    status: CallStatus.OPEN,
    isHidden: false,
    reportCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Call;

const makeUser = (overrides: Partial<Users> = {}): Users =>
  ({
    id: 'user-uuid-1',
    walletAddress: '0xABCDEF',
    banned: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Users;

// ── Mock factories ────────────────────────────────────────────────────────────

const mockCallRepo = () => ({
  findAndCount: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const mockReportRepo = () => ({
  createQueryBuilder: jest.fn(),
});

const mockUsersRepo = () => ({
  findOneBy: jest.fn(),
  save: jest.fn(),
  count: jest.fn(),
});

// ── Test suite ────────────────────────────────────────────────────────────────

describe('AdminService', () => {
  let service: AdminService;
  let callRepo: ReturnType<typeof mockCallRepo>;
  let reportRepo: ReturnType<typeof mockReportRepo>;
  let usersRepo: ReturnType<typeof mockUsersRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(Call), useFactory: mockCallRepo },
        { provide: getRepositoryToken(CallReport), useFactory: mockReportRepo },
        { provide: getRepositoryToken(Users), useFactory: mockUsersRepo },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    callRepo = module.get(getRepositoryToken(Call));
    reportRepo = module.get(getRepositoryToken(CallReport));
    usersRepo = module.get(getRepositoryToken(Users));
  });

  // ── listCalls ──────────────────────────────────────────────────────────────

  describe('listCalls', () => {
    it('returns all calls when no status filter', async () => {
      const calls = [makeCall()];
      callRepo.findAndCount.mockResolvedValue([calls, 1]);

      const result = await service.listCalls({ page: 1, limit: 20 });
      expect(callRepo.findAndCount).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 20,
      });
      expect(result).toEqual({ data: calls, total: 1, page: 1, limit: 20 });
    });

    it('filters by status when provided', async () => {
      const paused = [makeCall({ status: CallStatus.PAUSED })];
      callRepo.findAndCount.mockResolvedValue([paused, 1]);

      const result = await service.listCalls({ status: CallStatus.PAUSED });
      expect(callRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: CallStatus.PAUSED } }),
      );
      expect(result.data[0].status).toBe(CallStatus.PAUSED);
    });

    it('applies pagination correctly', async () => {
      callRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.listCalls({ page: 3, limit: 10 });
      expect(callRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  // ── hideCall ───────────────────────────────────────────────────────────────

  describe('hideCall', () => {
    it('sets isHidden to true', async () => {
      const call = makeCall();
      callRepo.findOneBy.mockResolvedValue(call);
      callRepo.save.mockResolvedValue({ ...call, isHidden: true });

      const result = await service.hideCall('call-uuid-1');
      expect(callRepo.save).toHaveBeenCalledWith({ ...call, isHidden: true });
      expect(result.isHidden).toBe(true);
    });

    it('throws NotFoundException for unknown call', async () => {
      callRepo.findOneBy.mockResolvedValue(null);
      await expect(service.hideCall('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when already hidden', async () => {
      callRepo.findOneBy.mockResolvedValue(makeCall({ isHidden: true }));
      await expect(service.hideCall('call-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── unhideCall ─────────────────────────────────────────────────────────────

  describe('unhideCall', () => {
    it('sets isHidden to false', async () => {
      const call = makeCall({ isHidden: true });
      callRepo.findOneBy.mockResolvedValue(call);
      callRepo.save.mockResolvedValue({ ...call, isHidden: false });

      const result = await service.unhideCall('call-uuid-1');
      expect(callRepo.save).toHaveBeenCalledWith({ ...call, isHidden: false });
      expect(result.isHidden).toBe(false);
    });

    it('throws BadRequestException when not hidden', async () => {
      callRepo.findOneBy.mockResolvedValue(makeCall({ isHidden: false }));
      await expect(service.unhideCall('call-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── banUser ────────────────────────────────────────────────────────────────

  describe('banUser', () => {
    it('sets banned to true', async () => {
      const user = makeUser();
      usersRepo.findOneBy.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue({ ...user, banned: true });

      const result = await service.banUser('0xABCDEF');
      expect(usersRepo.save).toHaveBeenCalledWith({ ...user, banned: true });
      expect(result.banned).toBe(true);
    });

    it('throws NotFoundException for unknown user', async () => {
      usersRepo.findOneBy.mockResolvedValue(null);
      await expect(service.banUser('0xUNKNOWN')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when already banned', async () => {
      usersRepo.findOneBy.mockResolvedValue(makeUser({ banned: true }));
      await expect(service.banUser('0xABCDEF')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── unbanUser ──────────────────────────────────────────────────────────────

  describe('unbanUser', () => {
    it('sets banned to false', async () => {
      const user = makeUser({ banned: true });
      usersRepo.findOneBy.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue({ ...user, banned: false });

      const result = await service.unbanUser('0xABCDEF');
      expect(usersRepo.save).toHaveBeenCalledWith({ ...user, banned: false });
      expect(result.banned).toBe(false);
    });

    it('throws BadRequestException when not banned', async () => {
      usersRepo.findOneBy.mockResolvedValue(makeUser({ banned: false }));
      await expect(service.unbanUser('0xABCDEF')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── getStats ───────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns aggregated metrics', async () => {
      // Mock the query builder chain for pendingReports
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(5),
      } as unknown as SelectQueryBuilder<CallReport>;
      reportRepo.createQueryBuilder.mockReturnValue(qb);

      usersRepo.count.mockResolvedValue(12);
      callRepo.count.mockResolvedValue(3);

      const result = await service.getStats();
      expect(result).toEqual({
        activeUsersToday: 12,
        pendingReports: 5,
        pausedCalls: 3,
      });
    });
  });
});
