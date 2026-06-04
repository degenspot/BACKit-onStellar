import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { QueuesStatusService } from './queues.status.service';

@ApiTags('admin')
@Controller('admin/queues')
export class AdminQueuesController {
  constructor(private readonly statusService: QueuesStatusService) {}

  @Get('status')
  @ApiOperation({ summary: 'Queue status' })
  getStatus() {
    return this.statusService.getStatus();
  }
}
