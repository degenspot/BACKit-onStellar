import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  UsePipes,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { WebhookService } from './webhook.service';
import {
  CreateWebhookSubscriptionDto,
  TestWebhookDto,
} from './dto/webhook.dto';
import { WebhookSubscription } from './webhook-subscription.entity';
import { WEBHOOK_EVENT_TYPES } from './webhook-event-types';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly webhookService: WebhookService) {}

  @Post('subscribe')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a webhook URL for event notifications',
    description:
      'Creates a new webhook subscription. A unique HMAC secret is generated and returned. ' +
      'The subscriber must store this secret to verify incoming webhook payloads. ' +
      `Supported events: ${WEBHOOK_EVENT_TYPES.join(', ')}`,
  })
  @ApiResponse({
    status: 201,
    description: 'Webhook subscription created successfully',
    schema: {
      example: {
        id: 'uuid',
        userAddress: 'GCXXX...',
        url: 'https://example.com/webhook',
        secret: 'hex-encoded-64-char-secret',
        events: ['call.resolved', 'payout.ready'],
        isActive: true,
        createdAt: '2026-07-27T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async subscribe(
    @Body() dto: CreateWebhookSubscriptionDto,
  ): Promise<WebhookSubscription> {
    this.logger.log(`Subscribe webhook for ${dto.userAddress} -> ${dto.url}`);
    return this.webhookService.subscribe(dto.userAddress, dto.url, dto.events);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unsubscribe a webhook by ID' })
  @ApiParam({ name: 'id', description: 'Webhook subscription ID (UUID)' })
  @ApiQuery({ name: 'userAddress', required: true, description: 'Stellar wallet address' })
  @ApiResponse({ status: 204, description: 'Unsubscribed successfully' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async unsubscribe(
    @Param('id') id: string,
    @Query('userAddress') userAddress: string,
  ): Promise<void> {
    if (!userAddress) {
      throw new BadRequestException('userAddress query parameter is required');
    }
    await this.webhookService.unsubscribe(id, userAddress);
  }

  @Get()
  @ApiOperation({
    summary: 'List all webhook subscriptions for a user with delivery stats',
  })
  @ApiQuery({ name: 'userAddress', required: true, description: 'Stellar wallet address' })
  @ApiResponse({
    status: 200,
    description: 'List of webhook subscriptions with delivery statistics',
  })
  @ApiResponse({ status: 400, description: 'userAddress query param is required' })
  async listSubscriptions(
    @Query('userAddress') userAddress: string,
  ) {
    if (!userAddress) {
      throw new BadRequestException('userAddress query parameter is required');
    }
    return this.webhookService.listSubscriptions(userAddress);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a test webhook ping to verify the URL works',
    description:
      'Sends a test event to the webhook URL with a test payload to verify ' +
      'connectivity without creating a permanent subscription.',
  })
  @ApiResponse({
    status: 200,
    description: 'Test ping result',
    schema: {
      example: {
        success: true,
        statusCode: 200,
        message: 'Test ping sent successfully',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async testWebhook(
    @Body() dto: TestWebhookDto,
  ): Promise<{ success: boolean; statusCode: number; message: string }> {
    // Create a temporary subscription object just for the test ping
    const subscription = {
      id: 'test',
      userAddress: dto.userAddress,
      url: dto.url,
      secret: dto.secret,
      events: ['call.created'],
      isActive: true,
      createdAt: new Date(),
    } as WebhookSubscription;

    return this.webhookService.sendTestPing(subscription);
  }
}
