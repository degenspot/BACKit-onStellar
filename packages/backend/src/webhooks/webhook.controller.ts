import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { WebhookService } from './webhook.service';
import {
  SubscribeWebhookDto,
  WebhookSubscriptionDto,
  TestWebhookResponseDto,
  WebhookDeliveryLogDto,
} from './webhook.dto';

@ApiTags('Webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('subscribe')
  @ApiOperation({
    summary: 'Subscribe to webhook events',
    description:
      'Register a URL to receive signed event payloads. Provide a secret (min 16 chars) for HMAC-SHA256 verification.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: WebhookSubscriptionDto })
  async subscribe(
    @CurrentUser() userAddress: string,
    @Body() dto: SubscribeWebhookDto,
  ): Promise<WebhookSubscriptionDto> {
    return this.webhookService.subscribe(userAddress, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unsubscribe from a webhook' })
  @ApiParam({ name: 'id', description: 'Subscription UUID' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  async unsubscribe(
    @CurrentUser() userAddress: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.webhookService.unsubscribe(userAddress, id);
  }

  @Get()
  @ApiOperation({
    summary: "List current user's webhook subscriptions with delivery stats",
  })
  @ApiResponse({ status: HttpStatus.OK, type: [WebhookSubscriptionDto] })
  async list(
    @CurrentUser() userAddress: string,
  ): Promise<WebhookSubscriptionDto[]> {
    return this.webhookService.listSubscriptions(userAddress);
  }

  @Post(':id/test')
  @ApiOperation({
    summary: 'Send a test ping to verify the webhook URL',
    description:
      'Sends a test payload to the registered URL immediately (not via queue). Returns the HTTP response status.',
  })
  @ApiParam({ name: 'id', description: 'Subscription UUID' })
  @ApiResponse({ status: HttpStatus.OK, type: TestWebhookResponseDto })
  async test(
    @CurrentUser() userAddress: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TestWebhookResponseDto> {
    return this.webhookService.sendTestPing(userAddress, id);
  }

  @Get(':id/logs')
  @ApiOperation({
    summary: 'Get delivery logs for a subscription (last 100)',
  })
  @ApiParam({ name: 'id', description: 'Subscription UUID' })
  @ApiResponse({ status: HttpStatus.OK, type: [WebhookDeliveryLogDto] })
  async getLogs(
    @CurrentUser() userAddress: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WebhookDeliveryLogDto[]> {
    return this.webhookService.getDeliveryLogs(userAddress, id);
  }
}
