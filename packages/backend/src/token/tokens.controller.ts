import { Controller, Get, Param, Query } from '@nestjs/common';
import { TokensService } from './tokens.service';
import { Token } from './entities/token.entity';

@Controller('tokens')
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  /**
   * GET /tokens
   * Returns the active token list for frontend dropdowns.
   */
  @Get()
  async getTokens(): Promise<Token[]> {
    return this.tokensService.getAll();
  }

  @Get('search')
  async searchTokens(@Query('q') query: string) {
    return this.tokensService.searchDexPairs(query ?? '');
  }

  @Get(':pair/price')
  async getPairPrice(@Param('pair') pair: string) {
    return this.tokensService.getPairPrice(pair);
  }
}
