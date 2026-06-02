import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TokensService } from './tokens.service';
import { Token } from './entities/token.entity';
import { PriceHistoryService, PricePeriod } from './price-history.service';

@Controller('tokens')
export class TokensController {
  constructor(
    private readonly tokensService: TokensService,
    private readonly priceHistoryService: PriceHistoryService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Returns the active token list for frontend dropdowns',
  })
  @ApiQuery({
    name: 'whitelisted',
    required: false,
    type: Boolean,
    description: 'If true, only returns whitelisted tokens',
  })
  async getTokens(
    @Query('whitelisted') whitelisted?: string,
  ): Promise<Token[]> {
    const whitelistedOnly = whitelisted === 'true';
    return this.tokensService.getAll(whitelistedOnly);
  }

  @Get('search')
  async searchTokens(@Query('q') query: string) {
    return this.tokensService.searchDexPairs(query ?? '');
  }

  @Get(':pair/price')
  async getPairPrice(@Param('pair') pair: string) {
    return this.tokensService.getPairPrice(pair);
  }

  @Get(':pair/prices')
  @ApiOperation({ summary: 'Get price history for a token pair' })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['1h', '24h', '7d'],
    description: 'Time period for price history (default: 24h)',
  })
  async getPriceHistory(
    @Param('pair') pair: string,
    @Query('period') period?: string,
  ) {
    const validPeriods: PricePeriod[] = ['1h', '24h', '7d'];
    const p: PricePeriod = validPeriods.includes(period as PricePeriod)
      ? (period as PricePeriod)
      : '24h';
    return this.priceHistoryService.getHistory(pair, p);
  }
}
