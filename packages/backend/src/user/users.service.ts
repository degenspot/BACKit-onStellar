/// <reference types="multer" />
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Users } from './entities/users.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsService } from '../analytics/analytics.service';
import { RegisterDto } from './dto/register.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import { Follow } from './entities/follow.entity';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import { IpfsService } from '../storage/ipfs.service';
import { CreateProfileDto, UpdateProfileDto } from './dto/profile.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,
    @InjectRepository(Follow)
    private readonly followsRepo: Repository<Follow>,
    private readonly analyticsService: AnalyticsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly preferenceService: NotificationPreferencesService,
    private readonly ipfsService: IpfsService,
  ) {}

  private generateReferralCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  async findOrCreateByAddress(walletAddress: string): Promise<Users> {
    let user = await this.usersRepo.findOne({ where: { walletAddress } });
    if (!user) {
      user = this.usersRepo.create({
        walletAddress,
        referralCode: this.generateReferralCode(),
      });
      user = await this.usersRepo.save(user);
      // Default notification preferences on user creation
      await this.preferenceService
        .initializePreferences(walletAddress)
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Failed to initialize notification preferences for ${walletAddress}: ${msg}`,
          );
        });
    }
    return user;
  }

  async follow(followerAddress: string, followingAddress: string) {
    if (followerAddress === followingAddress) {
      throw new BadRequestException('You cannot follow yourself');
    }

    await this.findOrCreateByAddress(followerAddress);
    await this.findOrCreateByAddress(followingAddress);

    const existing = await this.followsRepo.findOne({
      where: { followerAddress, followingAddress },
    });
    if (existing) {
      throw new ConflictException('Already following this user');
    }

    const result = await this.followsRepo.save(
      this.followsRepo.create({ followerAddress, followingAddress }),
    );
    await this.invalidateUserProfile(followerAddress);
    await this.invalidateUserProfile(followingAddress);
    return result;
  }

  async unfollow(followerAddress: string, followingAddress: string) {
    const follow = await this.followsRepo.findOne({
      where: { followerAddress, followingAddress },
    });
    if (!follow) {
      throw new BadRequestException('Not following this user');
    }

    const result = await this.followsRepo.remove(follow);
    await this.invalidateUserProfile(followerAddress);
    await this.invalidateUserProfile(followingAddress);
    return result;
  }

  private async invalidateUserProfile(address: string) {
    const ranges = ['7d', '30d', 'all'];
    for (const range of ranges) {
      await this.cacheManager.del(`profile:${address}:${range}`);
    }
  }

  async getFollowers(address: string, page = 1, limit = 20) {
    const [data, total] = await this.followsRepo.findAndCount({
      where: { followingAddress: address },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async getFollowing(address: string, page = 1, limit = 20) {
    const [data, total] = await this.followsRepo.findAndCount({
      where: { followerAddress: address },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async register(registerDto: RegisterDto) {
    const { referralCode, walletAddress, ...userData } =
      registerDto as RegisterDto & {
        email: string;
        walletAddress: string;
      };

    let referrer: Users | null = null;

    if (referralCode) {
      referrer = await this.usersRepo.findOne({ where: { referralCode } });
      if (!referrer) throw new BadRequestException('Invalid referral code');
    }

    if (referrer && referrer.email === userData.email) {
      throw new BadRequestException('Cannot refer yourself');
    }

    const newUser = this.usersRepo.create({
      ...userData,
      walletAddress,
      referralCode: this.generateReferralCode(),
    });

    if (referrer) newUser.referredBy = referrer;

    const savedUser = await this.usersRepo.save(newUser);
    // Default notification preferences on user creation
    await this.preferenceService
      .initializePreferences(walletAddress)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to initialize notification preferences for ${walletAddress}: ${msg}`,
        );
      });
    return savedUser;
  }

  async getUserProfile(userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    const reliability =
      await this.analyticsService.calculatePredictorReliability(userId);
    return { ...user, predictorReliability: reliability };
  }

  // ─── fetch by wallet address with badges ─────────────────────────────

  async getUserByAddress(walletAddress: string) {
    const user = await this.usersRepo.findOne({
      where: { walletAddress },
      relations: ['badges'],
    });

    if (!user) throw new NotFoundException(`User ${walletAddress} not found`);

    const reliability =
      await this.analyticsService.calculatePredictorReliability(user.id);
    const reputationScore =
      await this.analyticsService.calculateReputationScore(walletAddress);
    const [followerCount, followingCount] = await Promise.all([
      this.followsRepo.count({ where: { followingAddress: walletAddress } }),
      this.followsRepo.count({ where: { followerAddress: walletAddress } }),
    ]);

    return {
      ...user,
      predictorReliability: reliability,
      reputationScore,
      followerCount,
      followingCount,
      avatarUrl: user.avatarCid ? `ipfs://${user.avatarCid}` : null,
    };
  }

  async createProfile(
    createProfileDto: CreateProfileDto,
    avatarFile?: Express.Multer.File,
  ) {
    let user = await this.usersRepo.findOne({
      where: { walletAddress: createProfileDto.walletAddress },
    });
    if (user) {
      throw new ConflictException('Profile already exists');
    }

    let avatarCid: string | undefined;
    if (avatarFile) {
      avatarCid = await this.ipfsService.pinAvatar(avatarFile);
    }

    user = this.usersRepo.create({
      walletAddress: createProfileDto.walletAddress,
      referralCode: this.generateReferralCode(),
      displayName: createProfileDto.displayName,
      bio: createProfileDto.bio,
      avatarCid,
    });

    await this.usersRepo.save(user);
    return this.getUserByAddress(createProfileDto.walletAddress);
  }

  async updateProfile(
    updateProfileDto: UpdateProfileDto,
    avatarFile?: Express.Multer.File,
  ) {
    const user = await this.usersRepo.findOne({
      where: { walletAddress: updateProfileDto.walletAddress },
    });
    if (!user) {
      throw new NotFoundException(
        `User ${updateProfileDto.walletAddress} not found`,
      );
    }

    if (avatarFile) {
      user.avatarCid = await this.ipfsService.pinAvatar(avatarFile);
    }
    if (updateProfileDto.displayName !== undefined) {
      user.displayName = updateProfileDto.displayName;
    }
    if (updateProfileDto.bio !== undefined) {
      user.bio = updateProfileDto.bio;
    }

    await this.usersRepo.save(user);
    await this.invalidateUserProfile(user.walletAddress);
    return this.getUserByAddress(user.walletAddress);
  }
}
