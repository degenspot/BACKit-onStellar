import {
  IsString,
  IsNotEmpty,
  MaxLength,
  MinLength,
  IsUUID,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({
    description: 'The body content of the comment',
    minLength: 1,
    maxLength: 2000,
    example: 'This SOL breakdown is extremely informative!',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(2000)
  content: string;

  @ApiPropertyOptional({
    description: 'The parent comment ID to reply to',
    type: String,
    example: 'a6b8e8f8-dcd6-4e5a-93ef-fc1533fb85a6',
  })
  @IsUUID()
  @IsOptional()
  parentId?: string;
}
