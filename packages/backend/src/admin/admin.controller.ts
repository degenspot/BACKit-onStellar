import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiOkResponse,
} from '@nestjs/swagger';
import { AdminGuard } from '../auth/guards/admin.guard';
import { AdminService } from './admin.service';
import { QueryAdminCallsDto } from './dto/query-admin-calls.dto';
import { Audited } from '../audit/decorators/audited.decorator';
import { AuditActionType } from '../audit/audit-log.entity';

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── Calls ────────────────────────────────────────────────────────────────

  @Get('calls')
  @ApiOperation({ summary: 'List calls with optional status filter' })
  @ApiOkResponse({ description: 'Paginated list of calls' })
  listCalls(@Query() query: QueryAdminCallsDto) {
    return this.adminService.listCalls(query);
  }

  @Post('calls/:id/hide')
  @ApiOperation({ summary: 'Manually hide a call' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Audited(
    AuditActionType.CALL_HIDDEN,
    (ctx) =>
      `call:${ctx.switchToHttp().getRequest<{ params: { id: string } }>().params.id}`,
  )
  hideCall(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.hideCall(id);
  }

  @Post('calls/:id/unhide')
  @ApiOperation({ summary: 'Unhide a call' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @Audited(
    AuditActionType.CALL_UNHIDDEN,
    (ctx) =>
      `call:${ctx.switchToHttp().getRequest<{ params: { id: string } }>().params.id}`,
  )
  unhideCall(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.unhideCall(id);
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  @Post('users/:address/ban')
  @ApiOperation({ summary: 'Ban a user by wallet address' })
  @ApiParam({ name: 'address', type: String })
  @Audited(
    AuditActionType.USER_BANNED,
    (ctx) =>
      `user:${ctx.switchToHttp().getRequest<{ params: { address: string } }>().params.address}`,
  )
  banUser(@Param('address') address: string) {
    return this.adminService.banUser(address);
  }

  @Post('users/:address/unban')
  @ApiOperation({ summary: 'Unban a user by wallet address' })
  @ApiParam({ name: 'address', type: String })
  @Audited(
    AuditActionType.USER_UNBANNED,
    (ctx) =>
      `user:${ctx.switchToHttp().getRequest<{ params: { address: string } }>().params.address}`,
  )
  unbanUser(@Param('address') address: string) {
    return this.adminService.unbanUser(address);
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({
    summary:
      'System metrics: active users today, pending reports, paused calls',
  })
  @ApiOkResponse({
    description: 'System stats',
    schema: {
      example: {
        activeUsersToday: 42,
        pendingReports: 7,
        pausedCalls: 3,
      },
    },
  })
  getStats() {
    return this.adminService.getStats();
  }
}
