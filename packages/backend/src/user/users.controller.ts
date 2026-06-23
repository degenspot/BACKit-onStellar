import {
/// <reference types="multer" />
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
  UseInterceptors,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
  UseInterceptors,
  UploadedFile,
  ParseFilePipeBuilder,
  Patch,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiConsumes,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { FollowDto } from './dto/follow.dto';
import { CreateProfileDto, UpdateProfileDto } from './dto/profile.dto';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post(':address/follow')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Follow a user' })
  @ApiParam({ name: 'address', description: 'Address of the user to follow' })
  @ApiResponse({ status: 200, description: 'User followed successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid request.' })
  @ApiResponse({ status: 409, description: 'Already following.' })
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
  async getFollowers(
    @Param('address') address: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.usersService.getFollowers(address, page, limit);
  }

  @Get(':address/following')
  @ApiOperation({ summary: 'Get following list' })
  @ApiParam({ name: 'address', description: 'User address' })
  @ApiResponse({ status: 200, description: 'Successfully retrieved following list.' })
  async getFollowing(
    @Param('address') address: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.usersService.getFollowing(address, page, limit);
  }

  // ─── profile creation and update ──────────────────────────────────────────

  @Post('profile')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create user profile' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Profile created successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid request.' })
  @ApiResponse({ status: 409, description: 'Profile already exists.' })
  @UseInterceptors(FileInterceptor('avatar'))
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async createProfile(
    @Body() createProfileDto: CreateProfileDto,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(jpg|jpeg|png|webp)$/ })
        .addMaxSizeValidator({ maxSize: 2 * 1024 * 1024 })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          fileIsRequired: false,
        }),
    )
    avatarFile?: Express.Multer.File,
  ) {
    return this.usersService.createProfile(createProfileDto, avatarFile);
  }

  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update user profile' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'Profile updated successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid request.' })
  @ApiResponse({ status: 404, description: 'Profile not found.' })
  @UseInterceptors(FileInterceptor('avatar'))
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async updateProfile(
    @Body() updateProfileDto: UpdateProfileDto,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(jpg|jpeg|png|webp)$/ })
        .addMaxSizeValidator({ maxSize: 2 * 1024 * 1024 })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          fileIsRequired: false,
        }),
    )
    avatarFile?: Express.Multer.File,
  ) {
    return this.usersService.updateProfile(updateProfileDto, avatarFile);
  }

  // ─── NEW: profile with badges ─────────────────────────────────────────────

  @Get(':address')
  @UseInterceptors(CacheInterceptor)
  @CacheKey('user_profile_cache')
  @CacheTTL(300000)
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
