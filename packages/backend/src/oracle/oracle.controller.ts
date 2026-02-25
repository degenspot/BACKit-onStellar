import {
  Controller,
  Post,
  Param,
  Body,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OracleService } from './oracle.service';
import { AdminResolveDto } from './dto/admin-resolve.dto';
import { OracleCall } from './entities/oracle-call.entity';

@Controller('admin/markets')
export class OracleController {
  constructor(private readonly oracleService: OracleService) {}

  @Post(':id/unpause')
  @HttpCode(HttpStatus.OK)
  unpause(@Param('id', ParseIntPipe) id: number): Promise<OracleCall> {
    return this.oracleService.unpauseCall(id);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminResolveDto,
  ): Promise<OracleCall> {
    return this.oracleService.adminResolveCall(id, dto.resolution, dto.finalPrice); // ✅ types now match
  }
}