/**
 * usage-example.admin.controller.ts
 *
 * Shows how to apply @Audited() to sensitive admin routes in your existing
 * Oracle, OutcomeManager, or any other admin controller.
 *
 * DO NOT copy this file as-is — apply the patterns to your real controllers.
 */

import { Controller, Post, Body, Param, Patch } from '@nestjs/common';
import { Audited } from '../audit/decorators/audited.decorator';
import { AuditActionType } from '../audit/audit-log.entity';

// ─── Example: Oracle Admin Controller ─────────────────────────────────────

@Controller('admin/oracle')
export class OracleAdminController {
  /**
   * Updating oracle parameters → writes an ORACLE_PARAMS_UPDATED log entry.
   * targetResource is derived from the route params via the second argument.
   */
  @Audited(
    AuditActionType.ORACLE_PARAMS_UPDATED,
    (ctx) => {
      const req = ctx.switchToHttp().getRequest();
      return `oracle:feed:${req.params.feedId}`;
    },
  )
  @Patch('feeds/:feedId/params')
  updateOracleParams(
    @Param('feedId') feedId: string,
    @Body() dto: { minResponses: number; heartbeatSeconds: number },
  ) {
    // ... your oracle service call
  }

  /**
   * Setting a quorum → writes an ORACLE_QUORUM_SET log entry.
   */
  @Audited(
    AuditActionType.ORACLE_QUORUM_SET,
    (ctx) => {
      const req = ctx.switchToHttp().getRequest();
      return `oracle:quorum:${req.params.roundId}`;
    },
  )
  @Patch('rounds/:roundId/quorum')
  setQuorum(
    @Param('roundId') roundId: string,
    @Body() dto: { quorum: number },
  ) {
    // ... your oracle service call
  }
}

// ─── Example: Market Resolution Admin Controller ───────────────────────────

@Controller('admin/markets')
export class MarketAdminController {
  /**
   * Manually resolving a market → writes a MARKET_MANUALLY_RESOLVED log entry.
   */
  @Audited(
    AuditActionType.MARKET_MANUALLY_RESOLVED,
    (ctx) => {
      const req = ctx.switchToHttp().getRequest();
      return `market:${req.params.marketId}`;
    },
  )
  @Post(':marketId/resolve')
  resolveMarket(
    @Param('marketId') marketId: string,
    @Body() dto: { outcome: string; note?: string },
  ) {
    // ... your OutcomeManager service call
  }

  /**
   * Pausing a market → writes a MARKET_PAUSED log entry.
   */
  @Audited(
    AuditActionType.MARKET_PAUSED,
    (ctx) => {
      const req = ctx.switchToHttp().getRequest();
      return `market:${req.params.marketId}`;
    },
  )
  @Post(':marketId/pause')
  pauseMarket(@Param('marketId') marketId: string) {
    // ... your service call
  }
}