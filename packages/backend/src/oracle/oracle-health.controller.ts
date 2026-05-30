import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  OracleHealthService,
  OracleHealthSummary,
} from './oracle-health.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/oracle')
export class OracleHealthController {
  constructor(private readonly oracleHealthService: OracleHealthService) {}

  @Get('health')
  getHealth(): Promise<OracleHealthSummary> {
    return this.oracleHealthService.getHealth();
  }
}
