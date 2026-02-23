import { BadRequestException, Injectable } from '@nestjs/common';
import { Users } from './entities/users.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { RegisterDto } from './dto/register.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,

    private readonly analyticsService: AnalyticsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) { }

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
    }
    return user;
  }

  async follow(followerAddress: string, followingAddress: string) {
    if (followerAddress === followingAddress) {
      throw new BadRequestException('You cannot follow yourself');
    }

    const follower = await this.findOrCreateByAddress(followerAddress);
    const following = await this.findOrCreateByAddress(followingAddress);

    // Initialize following array if not loaded
    const loadedFollower = await this.usersRepo.findOne({
      where: { id: follower.id },
      relations: ['following'],
    });

    if (!loadedFollower) {
      throw new BadRequestException('Follower user not found');
    }

    if (loadedFollower.following.some((u) => u.id === following.id)) {
      throw new BadRequestException('Already following this user');
    }

    loadedFollower.following.push(following);
    const result = await this.usersRepo.save(loadedFollower);
    await this.invalidateUserProfile(followerAddress);
    await this.invalidateUserProfile(followingAddress);
    return result;
  }

  async unfollow(followerAddress: string, followingAddress: string) {
    const follower = await this.usersRepo.findOne({
      where: { walletAddress: followerAddress },
      relations: ['following'],
    });

    if (!follower) {
      throw new BadRequestException('Follower user not found');
    }

    const following = await this.usersRepo.findOne({
      where: { walletAddress: followingAddress },
    });

    if (!following) {
      throw new BadRequestException('User to unfollow not found');
    }

    follower.following = follower.following.filter((u) => u.id !== following.id);
    const result = await this.usersRepo.save(follower);
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

  async getFollowers(address: string) {
    const user = await this.usersRepo.findOne({
      where: { walletAddress: address },
      relations: ['followers'],
    });

    if (!user) {
      return [];
    }

    return user.followers;
  }

  async getFollowing(address: string) {
    const user = await this.usersRepo.findOne({
      where: { walletAddress: address },
      relations: ['following'],
    });

    if (!user) {
      return [];
    }

    return user.following;
  }

  async register(registerDto: RegisterDto) {
    const { referralCode, walletAddress, ...userData } = registerDto as RegisterDto & {
      email: string;
      walletAddress: string;
    };

    let referrer: Users | null = null;

    if (referralCode) {
      referrer = await this.usersRepo.findOne({
        where: { referralCode },
      });

      if (!referrer) {
        throw new BadRequestException('Invalid referral code');
      }
    }
    if (referrer && referrer.email === userData.email) {
      throw new BadRequestException('Cannot refer yourself');
    }

    const newUser = this.usersRepo.create({
      ...userData,
      walletAddress,
      referralCode: this.generateReferralCode(),
    });

    if (referrer) {
      newUser.referredBy = referrer;
    }

    return this.usersRepo.save(newUser);
  }

  async getUserProfile(userId: string) {
    const user = await this.usersRepo.findOne({
      where: { id: userId },
    });

    const reliability =
      await this.analyticsService.calculatePredictorReliability(userId);

    return {
      ...user,
      predictorReliability: reliability,
    };
  }
}
