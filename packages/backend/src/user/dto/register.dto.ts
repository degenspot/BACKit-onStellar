import { IsOptional, IsString } from 'class-validator';

export class RegisterDto {
  @IsOptional()
  @IsString()
  referralCode?: string;
}
