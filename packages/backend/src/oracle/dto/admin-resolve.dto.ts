import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OracleCallStatus } from '../entities/oracle-call.entity'; 

export class AdminResolveDto {
  @IsEnum([OracleCallStatus.RESOLVED_YES, OracleCallStatus.RESOLVED_NO], {
    message: 'resolution must be RESOLVED_YES or RESOLVED_NO',
  })
  resolution: OracleCallStatus.RESOLVED_YES | OracleCallStatus.RESOLVED_NO; // ✅
  
  @IsOptional()
  @IsString()
  finalPrice?: string;
}