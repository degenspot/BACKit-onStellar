import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Audited } from '../../audit/decorators/audited.decorator';
import { AuditActionType } from '../../audit/audit-log.entity';
import { QueuesStatusService } from './queues.status.service';
import { DeadLetterService } from './dead-letter.service';
import { ListDeadLetterEntriesDto } from './dto/list-dead-letter-entries.dto';
import { ReplayDeadLetterDto } from './dto/replay-dead-letter.dto';
import { DismissDeadLetterDto } from './dto/dismiss-dead-letter.dto';
import { rejectionToHttpException } from './dead-letter-http-errors';

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@UseGuards(AdminGuard)
@Controller('admin/queues')
export class AdminQueuesController {
  constructor(
    private readonly statusService: QueuesStatusService,
    private readonly deadLetterService: DeadLetterService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Queue status (job counts per queue)' })
  getStatus() {
    return this.statusService.getStatus();
  }

  @Get('dead-letter')
  @ApiOperation({
    summary: 'List dead-letter entries with cursor pagination and filters',
  })
  @ApiOkResponse({
    description: 'Page of dead-letter entries plus a nextCursor',
  })
  listDeadLetterEntries(@Query() query: ListDeadLetterEntriesDto) {
    return this.deadLetterService.listEntries(query);
  }

  @Get('dead-letter/:id')
  @ApiOperation({ summary: 'Inspect a single dead-letter entry' })
  @ApiParam({
    name: 'id',
    description: 'BullMQ job id on the dead-letter queue',
  })
  async getDeadLetterEntry(@Param('id') id: string) {
    const entry = await this.deadLetterService.getEntry(id);
    if (!entry) {
      throw rejectionToHttpException(`dead-letter entry not found: ${id}`);
    }
    return entry;
  }

  @Post('dead-letter/:id/replay')
  @ApiOperation({
    summary:
      'Replay a dead-lettered job by retrying the original job still held in its source queue',
  })
  @ApiParam({
    name: 'id',
    description: 'BullMQ job id on the dead-letter queue',
  })
  @Audited(
    AuditActionType.DEAD_LETTER_REPLAYED,
    (ctx) =>
      `dead-letter:${ctx.switchToHttp().getRequest<{ params: { id: string } }>().params.id}`,
  )
  async replayDeadLetterEntry(
    @Param('id') id: string,
    @Body() body: ReplayDeadLetterDto,
    @CurrentUser() actorId: string,
  ) {
    const result = await this.deadLetterService.replayEntry(
      id,
      actorId,
      body.reason,
    );
    if (result.outcome === 'rejected') {
      throw rejectionToHttpException(result.reason);
    }
    return result.entry;
  }

  @Post('dead-letter/:id/dismiss')
  @ApiOperation({ summary: 'Dismiss a dead-lettered job without replaying it' })
  @ApiParam({
    name: 'id',
    description: 'BullMQ job id on the dead-letter queue',
  })
  @Audited(
    AuditActionType.DEAD_LETTER_DISMISSED,
    (ctx) =>
      `dead-letter:${ctx.switchToHttp().getRequest<{ params: { id: string } }>().params.id}`,
  )
  async dismissDeadLetterEntry(
    @Param('id') id: string,
    @Body() body: DismissDeadLetterDto,
    @CurrentUser() actorId: string,
  ) {
    const result = await this.deadLetterService.dismissEntry(
      id,
      actorId,
      body.reason,
    );
    if (result.outcome === 'rejected') {
      throw rejectionToHttpException(result.reason);
    }
    return result.entry;
  }
}
