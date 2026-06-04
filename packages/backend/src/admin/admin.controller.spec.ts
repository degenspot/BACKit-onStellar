import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CallStatus } from '../calls/entities/call.entity';
import { Reflector } from '@nestjs/core';

// ── Minimal stubs ────────────────────────────────────────────────────────────

const makeCall = (overrides = {}) => ({
  id: 'call-uuid-1',
  title: 'Test Call',
  status: CallStatus.OPEN,
  isHidden: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeUser = (overrides = {}) => ({
  id: 'user-uuid-1',
  walletAddress: '0xABCDEF',
  banned: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const mockAdminService = {
  listCalls: jest.fn(),
  hideCall: jest.fn(),
  unhideCall: jest.fn(),
  banUser: jest.fn(),
  unbanUser: jest.fn(),
  getStats: jest.fn(),
};

// ── Test suite ───────────────────────────────────────────────────────────────

describe('AdminController', () => {
  let controller: AdminController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        Reflector,
      ],
    })
      // Override guards so we don't need a real JWT in unit tests
      .overrideGuard(require('../auth/guards/admin.guard').AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminController>(AdminController);
    jest.clearAllMocks();
  });

  // ── GET /admin/calls ───────────────────────────────────────────────────────

  describe('listCalls', () => {
    it('returns paginated calls without filter', async () => {
      const result = { data: [makeCall()], total: 1, page: 1, limit: 20 };
      mockAdminService.listCalls.mockResolvedValue(result);

      const response = await controller.listCalls({});
      expect(mockAdminService.listCalls).toHaveBeenCalledWith({});
      expect(response).toEqual(result);
    });

    it('passes status filter to service', async () => {
      const result = {
        data: [makeCall({ status: CallStatus.PAUSED })],
        total: 1,
        page: 1,
        limit: 20,
      };
      mockAdminService.listCalls.mockResolvedValue(result);

      await controller.listCalls({ status: CallStatus.PAUSED });
      expect(mockAdminService.listCalls).toHaveBeenCalledWith({
        status: CallStatus.PAUSED,
      });
    });
  });

  // ── POST /admin/calls/:id/hide ─────────────────────────────────────────────

  describe('hideCall', () => {
    it('hides a visible call', async () => {
      const hidden = makeCall({ isHidden: true });
      mockAdminService.hideCall.mockResolvedValue(hidden);

      const result = await controller.hideCall('call-uuid-1');
      expect(mockAdminService.hideCall).toHaveBeenCalledWith('call-uuid-1');
      expect(result).toEqual(hidden);
    });

    it('propagates BadRequestException when already hidden', async () => {
      mockAdminService.hideCall.mockRejectedValue(
        new BadRequestException('Call is already hidden'),
      );
      await expect(controller.hideCall('call-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('propagates NotFoundException for unknown call', async () => {
      mockAdminService.hideCall.mockRejectedValue(
        new NotFoundException('Call not-found not found'),
      );
      await expect(controller.hideCall('not-found')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── POST /admin/calls/:id/unhide ───────────────────────────────────────────

  describe('unhideCall', () => {
    it('unhides a hidden call', async () => {
      const visible = makeCall({ isHidden: false });
      mockAdminService.unhideCall.mockResolvedValue(visible);

      const result = await controller.unhideCall('call-uuid-1');
      expect(mockAdminService.unhideCall).toHaveBeenCalledWith('call-uuid-1');
      expect(result).toEqual(visible);
    });

    it('propagates BadRequestException when not hidden', async () => {
      mockAdminService.unhideCall.mockRejectedValue(
        new BadRequestException('Call is not hidden'),
      );
      await expect(controller.unhideCall('call-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── POST /admin/users/:address/ban ─────────────────────────────────────────

  describe('banUser', () => {
    it('bans an active user', async () => {
      const banned = makeUser({ banned: true });
      mockAdminService.banUser.mockResolvedValue(banned);

      const result = await controller.banUser('0xABCDEF');
      expect(mockAdminService.banUser).toHaveBeenCalledWith('0xABCDEF');
      expect(result).toEqual(banned);
    });

    it('propagates BadRequestException when already banned', async () => {
      mockAdminService.banUser.mockRejectedValue(
        new BadRequestException('User is already banned'),
      );
      await expect(controller.banUser('0xABCDEF')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('propagates NotFoundException for unknown user', async () => {
      mockAdminService.banUser.mockRejectedValue(
        new NotFoundException('User 0xUNKNOWN not found'),
      );
      await expect(controller.banUser('0xUNKNOWN')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── POST /admin/users/:address/unban ───────────────────────────────────────

  describe('unbanUser', () => {
    it('unbans a banned user', async () => {
      const active = makeUser({ banned: false });
      mockAdminService.unbanUser.mockResolvedValue(active);

      const result = await controller.unbanUser('0xABCDEF');
      expect(mockAdminService.unbanUser).toHaveBeenCalledWith('0xABCDEF');
      expect(result).toEqual(active);
    });

    it('propagates BadRequestException when not banned', async () => {
      mockAdminService.unbanUser.mockRejectedValue(
        new BadRequestException('User is not banned'),
      );
      await expect(controller.unbanUser('0xABCDEF')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── GET /admin/stats ───────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns system metrics', async () => {
      const stats = { activeUsersToday: 10, pendingReports: 3, pausedCalls: 1 };
      mockAdminService.getStats.mockResolvedValue(stats);

      const result = await controller.getStats();
      expect(mockAdminService.getStats).toHaveBeenCalled();
      expect(result).toEqual(stats);
    });
  });
});
