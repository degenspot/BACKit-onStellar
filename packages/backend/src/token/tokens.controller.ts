import { Controller, Get } from '@nestjs/common';
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
}