import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { ConfigService } from './config.service';
import { PlatformSettings } from './entities/platform-settings.entity';

@ApiTags('config')
@Controller('config')
export class PlatformConfigController {
  constructor(private readonly configService: ConfigService) {}

  /**
   * GET /config
   *
   * Called once on frontend boot to hydrate global fee calculations,
   * contract addresses, and any other platform-wide settings.
   *
   * Example response:
   * {
   *   "feePercent": 1.5,
   *   "contractId": "CXXX...",
   *   "oracleContractId": "CYYY...",
   *   "lastUpdatedAtLedger": 5123456,
   *   "updatedAt": "2024-01-26T10:30:00.000Z"
   * }
   */
  @Get()
  @ApiOperation({
    summary: 'Get platform configuration',
    description:
      'Returns the current platform fee and contract settings. ' +
      'Call once on app boot to globally configure fee calculations in the UI.',
  })
  @ApiOkResponse({
    description: 'Current platform settings',
    schema: {
      example: {
        feePercent: 1.5,
        contractId: 'CXXX...',
        oracleContractId: 'CYYY...',
        lastUpdatedByTxHash: 'abc123...',
        lastUpdatedAtLedger: 5123456,
        updatedAt: '2024-01-26T10:30:00.000Z',
      },
    },
  })
  async getConfig(): Promise<Omit<PlatformSettings, 'id' | 'createdAt'>> {
    const { id, createdAt, ...settings } = await this.configService.getSettings();
    return settings;
  }
}