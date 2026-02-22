import { BadRequestException, Injectable } from '@nestjs/common';
import { Users } from './entities/users.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,

    private readonly analyticsService: AnalyticsService,
  ) {}

  private generateReferralCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  async register(registerDto: RegisterDto) {
    const { referralCode, ...userData } = registerDto as RegisterDto & {
      email: string;
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
