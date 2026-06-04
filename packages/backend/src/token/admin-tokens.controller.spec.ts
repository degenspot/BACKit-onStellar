import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminTokensController } from './admin-tokens.controller';
import { TokensService } from './tokens.service';
import { Reflector } from '@nestjs/core';

const mockTokensService = {
  whitelistToken: jest.fn(),
  removeWhitelistedToken: jest.fn(),
};

describe('AdminTokensController', () => {
  let controller: AdminTokensController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminTokensController],
      providers: [
        { provide: TokensService, useValue: mockTokensService },
        Reflector,
      ],
    })
      .overrideGuard(require('../auth/guards/admin.guard').AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminTokensController>(AdminTokensController);
    jest.clearAllMocks();
  });

  describe('POST /admin/tokens/whitelist', () => {
    it('calls service.whitelistToken with dto', async () => {
      const dto = { assetCode: 'USDC', assetIssuer: 'GA5ZSE...' };
      const result = { id: '1', assetCode: 'USDC', isWhitelisted: true };
      mockTokensService.whitelistToken.mockResolvedValue(result);

      const response = await controller.whitelistToken(dto);
      expect(mockTokensService.whitelistToken).toHaveBeenCalledWith(
        dto,
        'admin',
      );
      expect(response).toEqual(result);
    });

    it('propagates BadRequestException from service', async () => {
      mockTokensService.whitelistToken.mockRejectedValue(
        new BadRequestException('Asset does not exist'),
      );
      await expect(
        controller.whitelistToken({ assetCode: 'FAKE' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('DELETE /admin/tokens/whitelist/:id', () => {
    it('calls service.removeWhitelistedToken with id', async () => {
      mockTokensService.removeWhitelistedToken.mockResolvedValue(undefined);

      await controller.removeWhitelistedToken('uuid-1');
      expect(mockTokensService.removeWhitelistedToken).toHaveBeenCalledWith(
        'uuid-1',
      );
    });

    it('propagates NotFoundException from service', async () => {
      mockTokensService.removeWhitelistedToken.mockRejectedValue(
        new NotFoundException('Token not found'),
      );
      await expect(controller.removeWhitelistedToken('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
