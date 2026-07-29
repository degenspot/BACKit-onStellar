import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SimulateTxDto {
  @ApiProperty({
    description: 'Unsigned XDR transaction string to simulate',
    example: 'AAAAAgAAAAD...',
  })
  @IsString()
  @IsNotEmpty()
  xdr: string;
}
