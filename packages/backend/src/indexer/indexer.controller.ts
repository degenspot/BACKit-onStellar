import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiResponse } from '@nestjs/swagger';
import { IndexerService } from './indexer.service';
import { EventLog, EventType } from './event-log.entity';
import { PlatformConfigDto } from './dto/platform-config.dto';

@ApiTags('indexer')
@Controller('indexer')
export class IndexerController {
  constructor(private readonly indexerService: IndexerService) {}

  @Get('status')
  @ApiResponse({
    status: 200,
    description: 'Returns indexer status',
    schema: {
      type: 'object',
      properties: {
        isRunning: { type: 'boolean' },
        lastProcessedLedger: { type: 'number', nullable: true },
        totalEventsIndexed: { type: 'number' },
        latestEventLedger: { type: 'number', nullable: true },
        latestEventTimestamp: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  async getStatus() {
    return await this.indexerService.getStatus();
  }

  @Get('events/latest')
  @ApiResponse({
    status: 200,
    description: 'Returns latest indexed events',
    type: [EventLog],
  })
  async getLatestEvents() {
    return await this.indexerService.getEventsByType(EventType.CALL_CREATED, undefined, undefined, 50);
  }

  @Get('events/:eventType')
  @ApiResponse({
    status: 200,
    description: 'Returns events of specific type',
    type: [EventLog],
  })
  async getEventsByType(@Param('eventType') eventType: EventType) {
    return await this.indexerService.getEventsByType(eventType);
  }

  @Get('config')
  @ApiResponse({
    status: 200,
    description: 'Returns platform configuration settings',
    type: PlatformConfigDto,
  })
  async getConfig(): Promise<PlatformConfigDto> {
    return await this.indexerService.getPlatformSettings();
  }
}