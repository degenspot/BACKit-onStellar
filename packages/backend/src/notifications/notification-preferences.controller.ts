import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { NotificationPreferencesService } from './notification-preferences.service';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

@ApiTags('users')
@Controller('users/:address/notification-preferences')
export class NotificationPreferencesController {
  constructor(
    private readonly preferencesService: NotificationPreferencesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get notification preferences for a user' })
  @ApiParam({
    name: 'address',
    description: 'Stellar wallet address of the user',
  })
  @ApiResponse({
    status: 200,
    description: 'List of user notification preferences.',
  })
  async getPreferences(@Param('address') address: string) {
    return this.preferencesService.getPreferences(address);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update notification preferences for a user' })
  @ApiParam({
    name: 'address',
    description: 'Stellar wallet address of the user',
  })
  @ApiBody({ type: UpdateNotificationPreferencesDto })
  @ApiResponse({
    status: 200,
    description: 'Updated list of notification preferences.',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async updatePreferences(
    @Param('address') address: string,
    @Body() body: UpdateNotificationPreferencesDto,
  ) {
    return this.preferencesService.updatePreferences(address, body.preferences);
  }
}
