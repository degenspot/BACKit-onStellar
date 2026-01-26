import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { 
  ApiTags, 
  ApiOperation, 
  ApiResponse,
  ApiExcludeController,
} from '@nestjs/swagger';

@ApiTags('default')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ 
    summary: 'Root endpoint',
    description: 'Returns a welcome message and API information',
  })
  @ApiResponse({
    status: 200,
    description: 'Welcome message',
    schema: {
      example: {
        message: 'Welcome to BACKit on Stellar API',
        version: '1.0.0',
        documentation: '/api/docs',
        health: '/health',
      },
    },
  })
  getHello() {
    return {
      message: this.appService.getHello(),
      version: '1.0.0',
      documentation: '/api/docs',
      health: '/health',
    };
  }
}