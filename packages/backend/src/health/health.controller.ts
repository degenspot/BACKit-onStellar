import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { 
  ApiTags, 
  ApiOperation, 
  ApiResponse,
  ApiOkResponse,
} from '@nestjs/swagger';

class HealthCheckResponseDto {
  status: string;
  database: string;
  timestamp: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ 
    summary: 'Health check',
    description: 'Check if the API and database are running and healthy. Returns the overall status and database connection status.',
  })
  @ApiOkResponse({
    description: 'API is healthy and database connection status',
    schema: {
      example: {
        status: 'ok',
        database: 'connected',
        timestamp: '2024-01-26T10:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Service unavailable - Database is disconnected',
    schema: {
      example: {
        status: 'ok',
        database: 'disconnected',
        timestamp: '2024-01-26T10:30:00.000Z',
      },
    },
  })
  async check() {
    let dbStatus = 'disconnected';
    try {
      await this.dataSource.query('SELECT 1');
      dbStatus = 'connected';
    } catch {
      dbStatus = 'disconnected';
    }

    return {
      status: 'ok',
      database: dbStatus,
      timestamp: new Date().toISOString(),
    };
  }
}