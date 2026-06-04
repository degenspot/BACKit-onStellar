import {
  Controller,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AdminGuard } from '../auth/guards/admin.guard';
import { TokensService } from './tokens.service';
import { WhitelistTokenDto } from './dto/whitelist-token.dto';
import { Token } from './entities/token.entity';

@ApiTags('admin / tokens')
@ApiBearerAuth('JWT-auth')
@UseGuards(AdminGuard)
@Controller('admin/tokens')
export class AdminTokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Post('whitelist')
  @ApiOperation({ summary: 'Add a token to the whitelist' })
  async whitelistToken(@Body() dto: WhitelistTokenDto): Promise<Token> {
    return this.tokensService.whitelistToken(dto, 'admin');
  }

  @Delete('whitelist/:id')
  @ApiOperation({ summary: 'Remove a token from the whitelist' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async removeWhitelistedToken(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.tokensService.removeWhitelistedToken(id);
  }
}
