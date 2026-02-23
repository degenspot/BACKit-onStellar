import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { FirewallService } from './firewall.service';
import { IpRuleType } from './entities/ip-rule.entity';
import { CreateIpRuleDto, QueryBlockedRequestsDto } from './dto/firewall.dto';
import { Audited } from '../audit/decorators/audited.decorator';
import { AuditActionType } from '../audit/audit-log.entity';

/**
 * NOTE: Uncomment your project's auth guards once wired up.
 * import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
 * import { AdminGuard } from '../auth/guards/admin.guard';
 */

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
// @UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/firewall')
export class FirewallController {
  constructor(private readonly firewallService: FirewallService) {}

  // ─── IP Rules ─────────────────────────────────────────────────────────────

  @Get('rules')
  @ApiOperation({ summary: 'List all IP whitelist/blacklist rules' })
  @ApiResponse({ status: 200, description: 'Array of IpRule entries' })
  getRules() {
    return this.firewallService.getRules();
  }

  @Post('rules')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add an IP whitelist or blacklist rule',
    description:
      'Accepts a plain IP address or CIDR range (e.g. "10.0.0.0/8"). ' +
      'WHITELIST rules take precedence over BLACKLIST rules.',
  })
  @ApiResponse({ status: 201, description: 'Rule created and cache refreshed' })
  @Audited(AuditActionType.ADMIN_ACTION, () => 'firewall:ip-rules')
  addRule(
    @Body() dto: CreateIpRuleDto,
    @Request() req: { user?: Record<string, string> },
  ) {
    const actorId = req.user?.['id'] ?? req.user?.['sub'] ?? 'unknown';
    return this.firewallService.addRule(
      dto.cidr,
      dto.type as IpRuleType,
      dto.reason ?? null,
      actorId,
    );
  }

  @Delete('rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an IP rule by UUID' })
  @ApiParam({ name: 'id', description: 'UUID of the IpRule to remove' })
  @ApiResponse({ status: 204, description: 'Rule removed and cache refreshed' })
  @Audited(AuditActionType.ADMIN_ACTION, (ctx) => {
    const id = ctx.switchToHttp().getRequest<{ params: { id: string } }>()
      .params.id;
    return `firewall:ip-rules:${id}`;
  })
  removeRule(@Param('id', ParseUUIDPipe) id: string) {
    return this.firewallService.removeRule(id);
  }

  // ─── Blocked Request Logs ────────────────────────────────────────────────

  @Get('blocked-requests')
  @ApiOperation({
    summary: 'List blocked request log entries',
    description:
      'Returns a paginated list of all requests that were dropped by the firewall middleware. ' +
      'Use errorCode values to cross-reference with external WAF / SIEM logs.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated blocked-request results',
  })
  getBlockedRequests(@Query() query: QueryBlockedRequestsDto) {
    return this.firewallService.getBlockedRequests(
      query.page,
      query.limit,
      query.ip,
      query.reason,
    );
  }
}
