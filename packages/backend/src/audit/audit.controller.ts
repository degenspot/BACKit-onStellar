import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { AuditLog } from './audit-log.entity';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/**
 * NOTE: Swap `JwtAuthGuard` and `AdminGuard` for whatever guards your project
 * already uses — e.g. an `@Roles('admin')` + `RolesGuard` combination.
 * The important thing is that these routes are protected before they reach this
 * controller. The imports below are placeholder names; adjust to your auth module.
 */
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { AdminGuard } from '../auth/guards/admin.guard';

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
// @UseGuards(JwtAuthGuard, AdminGuard)  ← uncomment when your guards are wired up
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * GET /admin/audit-logs
   *
   * Returns a paginated, filterable list of all audit log entries.
   * Accessible only to authenticated administrators.
   */
  @Get()
  @ApiOperation({
    summary: 'List audit logs',
    description:
      'Returns a paginated list of admin audit log entries. ' +
      'Supports filtering by actor, action type, status, resource, and date range.',
  })
  @ApiResponse({ status: 200, description: 'Paginated audit log results' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin access required' })
  async findAll(
    @Query() query: QueryAuditLogsDto,
  ): Promise<{ data: AuditLog[]; total: number; page: number; limit: number }> {
    const { data, total } = await this.auditService.findAll(query);
    return { data, total, page: query.page ?? 1, limit: query.limit ?? 50 };
  }

  /**
   * GET /admin/audit-logs/:id
   *
   * Returns a single audit log entry by its UUID.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get a single audit log entry by ID' })
  @ApiParam({ name: 'id', description: 'UUID of the audit log entry' })
  @ApiResponse({ status: 200, description: 'The requested audit log entry' })
  @ApiResponse({ status: 404, description: 'Entry not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AuditLog> {
    const entry = await this.auditService.findOne(id);
    if (!entry) throw new NotFoundException(`Audit log entry ${id} not found`);
    return entry;
  }
}