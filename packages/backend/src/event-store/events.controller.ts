import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { EventStoreService } from './event-store.service';
import { EventStoreEntry } from './entities/event-store-entry.entity';
import { QueryEventsDto } from './dto/query-events.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/events')
export class EventsController {
  constructor(private readonly eventStoreService: EventStoreService) {}

  /**
   * GET /admin/events
   *
   * Lists event_store rows, optionally filtered by aggregate_type,
   * aggregate_id, and a created_at date range. Newest first.
   */
  @Get()
  @ApiOperation({
    summary: 'List event store entries',
    description:
      'Returns a paginated list of append-only audit trail events. ' +
      'Supports filtering by aggregate type, aggregate ID, and date range.',
  })
  @ApiResponse({ status: 200, description: 'Paginated event store results' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — admin access required',
  })
  async findAll(@Query() query: QueryEventsDto): Promise<{
    data: EventStoreEntry[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { data, total } = await this.eventStoreService.queryEvents({
      aggregateType: query.aggregate_type,
      aggregateId: query.aggregate_id,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });

    return { data, total, page: query.page ?? 1, limit: query.limit ?? 50 };
  }
}
