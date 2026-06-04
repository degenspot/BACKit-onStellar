import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CallsService } from './calls.service';
import { ReportCallDto } from './dto/report-call.dto';
import { QueryCallsDto } from './dto/query-calls.dto';
import { PrepareCallDto } from './dto/prepare-call.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('calls')
@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get('feed')
  @ApiOperation({ summary: 'Get paginated feed of visible calls' })
  @ApiResponse({ status: 200, description: 'Feed returned successfully' })
  getFeed(@Query() query: QueryCallsDto) {
    return this.callsService.getFeed(query);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search calls by title or description' })
  @ApiResponse({ status: 200, description: 'Search results returned' })
  search(@Query() query: QueryCallsDto) {
    return this.callsService.search(query);
  }

  @Post('prepare')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Pin call content to IPFS and return CID for on-chain creation',
  })
  @ApiResponse({
    status: 201,
    description: 'Content pinned',
    schema: {
      example: {
        cid: 'bafybeig...',
        ipfsUrl: 'https://ipfs.io/ipfs/bafybeig...',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  prepareCall(@Body() dto: PrepareCallDto) {
    return this.callsService.prepareCall(dto);
  }

  @Post(':id/report')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Report a call for moderation' })
  @ApiParam({ name: 'id', description: 'Call UUID' })
  @ApiResponse({ status: 200, description: 'Report submitted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Already reported' })
  reportCall(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportCallDto,
    @Request() req: any,
  ) {
    return this.callsService.reportCall(id, req.user.address, dto);
  }
}
