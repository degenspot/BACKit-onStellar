import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReplayDeadLetterDto {
  @ApiProperty({
    description:
      'Operator justification for replaying this job - required, becomes part of the audit record',
    minLength: 5,
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;
}
