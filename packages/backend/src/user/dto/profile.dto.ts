import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Length,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProfileDto {
  @ApiProperty({
    description: 'The wallet address of the user',
    example: 'GC...',
  })
  @IsString()
  @IsNotEmpty()
  walletAddress: string;

  @ApiProperty({
    description: 'Display name (3-50 chars)',
    example: 'Alice',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Length(3, 50)
  displayName?: string;

  @ApiProperty({
    description: 'User bio (max 500 chars)',
    example: 'Hello world!',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;
}

export class UpdateProfileDto {
  @ApiProperty({
    description: 'The wallet address of the user',
    example: 'GC...',
  })
  @IsString()
  @IsNotEmpty()
  walletAddress: string;

  @ApiProperty({
    description: 'Display name (3-50 chars)',
    example: 'Alice',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Length(3, 50)
  displayName?: string;

  @ApiProperty({
    description: 'User bio (max 500 chars)',
    example: 'Hello world!',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;
}
