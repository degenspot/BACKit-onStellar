/// <reference types="multer" />
import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CreateProfileDto, UpdateProfileDto } from './dto/profile.dto';

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    follow: jest.fn(),
    unfollow: jest.fn(),
    getFollowers: jest.fn(),
    getFollowing: jest.fn(),
    getUserByAddress: jest.fn(),
    createProfile: jest.fn(),
    updateProfile: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('profile CRUD', () => {
    it('should create a profile', async () => {
      const dto: CreateProfileDto = {
        walletAddress: 'GC1',
        displayName: 'Alice',
        bio: 'Hello',
      };
      const file = {
        buffer: Buffer.from('test'),
        originalname: 'avatar.png',
      } as unknown as Express.Multer.File;
      mockUsersService.createProfile.mockResolvedValue({ id: 'u1', ...dto });

      const result = await controller.createProfile(dto, file);

      expect(mockUsersService.createProfile).toHaveBeenCalledWith(dto, file);
      expect(result.displayName).toBe('Alice');
    });

    it('should update a profile', async () => {
      const dto: UpdateProfileDto = {
        walletAddress: 'GC1',
        displayName: 'AliceUpdated',
      };
      const file = undefined;
      mockUsersService.updateProfile.mockResolvedValue({
        id: 'u1',
        walletAddress: 'GC1',
        displayName: 'AliceUpdated',
      });

      const result = await controller.updateProfile(dto, file);

      expect(mockUsersService.updateProfile).toHaveBeenCalledWith(dto, file);
      expect(result.displayName).toBe('AliceUpdated');
    });

    it('should get a profile by address', async () => {
      mockUsersService.getUserByAddress.mockResolvedValue({
        id: 'u1',
        walletAddress: 'GC1',
      });

      const result = await controller.getProfile('GC1');

      expect(mockUsersService.getUserByAddress).toHaveBeenCalledWith('GC1');
      expect(result.walletAddress).toBe('GC1');
    });
  });
});
