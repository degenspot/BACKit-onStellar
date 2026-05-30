import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

@Controller()
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Get('users/:address/payouts')
  getUserPayouts(@Param('address') address: string) {
    return this.payoutsService.listUserPayouts(address);
  }

  @Get('calls/:id/payouts')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getCallPayouts(@Param('id') callId: string) {
    return this.payoutsService.listCallPayouts(callId);
  }

  @Get('admin/payouts/unclaimed-overdue')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getOverdueUnclaimed() {
    return this.payoutsService.getOverdueUnclaimed();
  }
}
