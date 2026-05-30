import {
  Controller,
  Post,
  Param,
  Body,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { OracleService } from './oracle.service';
import { AdminResolveDto } from './dto/admin-resolve.dto';
import { OracleCall } from './entities/oracle-call.entity';
import { Audited } from '../audit/decorators/audited.decorator';
import { AuditActionType } from '../audit/audit-log.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/markets')
export class OracleController {
  constructor(private readonly oracleService: OracleService) {}

  @Audited(AuditActionType.MARKET_MANUALLY_RESOLVED, (ctx) => {
    const id = ctx.switchToHttp().getRequest().params.id;
    return `market:${id}`;
  })
  @Post(':id/unpause')
  @HttpCode(HttpStatus.OK)
  unpause(@Param('id', ParseIntPipe) id: number): Promise<OracleCall> {
    return this.oracleService.unpauseCall(id);
  }

  @Audited(AuditActionType.MARKET_MANUALLY_RESOLVED, (ctx) => {
    const id = ctx.switchToHttp().getRequest().params.id;
    return `market:${id}`;
  })
  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdminResolveDto,
  ): Promise<OracleCall> {
    return this.oracleService.adminResolveCall(
      id,
      dto.resolution,
      dto.finalPrice,
    ); // ✅ types now match
  }

  // ─── Oracle Parameters & Quorums ──────────────────────────────────────────

  @Audited(AuditActionType.ORACLE_PARAMS_UPDATED, (ctx) => {
    const feedId = ctx.switchToHttp().getRequest().params.feedId;
    return `oracle:feed:${feedId}`;
  })
  @Patch('feeds/:feedId/params')
  @HttpCode(HttpStatus.OK)
  updateOracleParams(
    @Param('feedId') feedId: string,
    @Body() dto: { minResponses: number; heartbeatSeconds: number },
  ) {
    return this.oracleService.updateParams(feedId, dto);
  }

  @Audited(AuditActionType.ORACLE_QUORUM_SET, (ctx) => {
    const roundId = ctx.switchToHttp().getRequest().params.roundId;
    return `oracle:round:${roundId}`;
  })
  @Patch('rounds/:roundId/quorum')
  @HttpCode(HttpStatus.OK)
  setQuorum(
    @Param('roundId') roundId: string,
    @Body() dto: { quorum: number },
  ) {
    return this.oracleService.setQuorum(roundId, dto.quorum);
  }
}
