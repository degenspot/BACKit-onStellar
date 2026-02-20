import {
    Controller,
    Get,
    Post,
    Body,
    Query,
    HttpCode,
    HttpStatus,
    ValidationPipe,
    UsePipes,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBody } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { GetNotificationsDto } from './dto/get-notifications.dto';
import { MarkReadDto } from './dto/mark-read.dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
    constructor(private readonly notificationsService: NotificationsService) { }

    @Get()
    @ApiOperation({ summary: 'Get paginated notifications for a user' })
    @ApiQuery({ name: 'userId', required: true, description: 'Wallet address of the user' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiQuery({ name: 'offset', required: false, type: Number })
    @ApiResponse({ status: 200, description: 'Paginated notification list with unreadCount.' })
    @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
    async getNotifications(@Query() query: GetNotificationsDto) {
        return this.notificationsService.getNotifications(
            query.userId,
            query.limit,
            query.offset,
        );
    }

    @Post('mark-read')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Mark notifications as read. Omit ids to mark all read.' })
    @ApiBody({ type: MarkReadDto })
    @ApiQuery({ name: 'userId', required: true, description: 'Wallet address of the user' })
    @ApiResponse({ status: 200, description: 'Number of notifications updated.' })
    @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
    async markRead(
        @Query('userId') userId: string,
        @Body() body: MarkReadDto,
    ) {
        return this.notificationsService.markRead(userId, body.ids);
    }
}
