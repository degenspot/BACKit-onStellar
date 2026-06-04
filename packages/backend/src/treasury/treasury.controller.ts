import {
  Controller,
  Get,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { TreasuryService } from './treasury.service';
import { TreasurySummaryQueryDto } from './dto/treasury-summary.dto';
import { TreasuryHistoryQueryDto } from './dto/treasury-history.dto';

@ApiTags('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/treasury')
export class TreasuryController {
  constructor(private readonly treasuryService: TreasuryService) {}

  @Get()
  @ApiOperation({ summary: 'Treasury totals broken down by token' })
  getSummary(
    @Query(new ValidationPipe({ transform: true }))
    query: TreasurySummaryQueryDto,
  ) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    return this.treasuryService.getSummary(from, to);
  }

  @Get('history')
  @ApiOperation({ summary: 'Treasury fee entry history (paginated)' })
  getHistory(
    @Query(new ValidationPipe({ transform: true }))
    query: TreasuryHistoryQueryDto,
  ) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    return this.treasuryService.getHistory({
      page: query.page ?? 1,
      limit: query.limit ?? 50,
      from,
      to,
      tokenAddress: query.tokenAddress,
    });
  }
}
