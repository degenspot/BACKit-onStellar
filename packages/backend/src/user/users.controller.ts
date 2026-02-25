import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { FollowDto } from './dto/follow.dto';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ─── existing endpoints — unchanged ──────────────────────────────────────

  @Post(':address/follow')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Follow a user' })
  @ApiParam({ name: 'address', description: 'Address of the user to follow' })
  @ApiResponse({ status: 200, description: 'User followed successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid request or already following.' })
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async follow(
    @Param('address') address: string,
    @Body() followDto: FollowDto,
  ) {
    return this.usersService.follow(followDto.followerAddress, address);
  }

  @Post(':address/unfollow')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unfollow a user' })
  @ApiParam({ name: 'address', description: 'Address of the user to unfollow' })
  @ApiResponse({ status: 200, description: 'User unfollowed successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid request or not following.' })
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async unfollow(
    @Param('address') address: string,
    @Body() followDto: FollowDto,
  ) {
    return this.usersService.unfollow(followDto.followerAddress, address);
  }

  @Get(':address/followers')
  @ApiOperation({ summary: 'Get followers list' })
  @ApiParam({ name: 'address', description: 'User address' })
  @ApiResponse({ status: 200, description: 'Successfully retrieved followers.' })
  async getFollowers(@Param('address') address: string) {
    return this.usersService.getFollowers(address);
  }

  @Get(':address/following')
  @ApiOperation({ summary: 'Get following list' })
  @ApiParam({ name: 'address', description: 'User address' })
  @ApiResponse({ status: 200, description: 'Successfully retrieved following list.' })
  async getFollowing(@Param('address') address: string) {
    return this.usersService.getFollowing(address);
  }

  // ─── NEW: profile with badges ─────────────────────────────────────────────

  @Get(':address')
  @ApiOperation({ summary: 'Get user profile with badges' })
  @ApiParam({ name: 'address', description: 'Stellar wallet address' })
  @ApiResponse({
    status: 200,
    description: 'User profile including assigned badges and predictor reliability.',
    schema: {
      example: {
        id: 'uuid',
        walletAddress: 'GCXXX...',
        referralCode: 'ABC123',
        badges: [
          { type: 'EARLY_ADOPTER', name: 'Early Adopter' },
          { type: 'HIGH_ACCURACY', name: 'High Accuracy' },
        ],
        predictorReliability: 0.73,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async getProfile(@Param('address') address: string) {
    return this.usersService.getUserByAddress(address);
  }
}