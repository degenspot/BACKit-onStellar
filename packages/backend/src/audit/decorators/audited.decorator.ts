import { SetMetadata, applyDecorators, UseInterceptors } from '@nestjs/common';
import { AuditActionType } from '../audit-log.entity';
import { AuditInterceptor } from '../interceptors/audit.interceptor';

export const AUDIT_ACTION_KEY = 'audit:action';
export const AUDIT_RESOURCE_KEY = 'audit:resource';

/**
 * @Audited(actionType, targetResourceFn)
 *
 * Attach this decorator to any admin controller method you want logged.
 * The interceptor picks up the metadata and writes the log entry automatically.
 *
 * @param actionType    - One of the AuditActionType enum values
 * @param getResource   - Optional function that receives the ExecutionContext
 *                        and returns a resource string. Defaults to the route path.
 *
 * @example
 * \@Audited(AuditActionType.MARKET_MANUALLY_RESOLVED, (ctx) => {
 *   const req = ctx.switchToHttp().getRequest();
 *   return `market:${req.params.marketId}`;
 * })
 * \@Post(':marketId/resolve')
 * resolveMarket(...) { ... }
 */
export function Audited(
  actionType: AuditActionType,
  getResource?: (ctx: import('@nestjs/common').ExecutionContext) => string,
) {
  return applyDecorators(
    SetMetadata(AUDIT_ACTION_KEY, actionType),
    SetMetadata(AUDIT_RESOURCE_KEY, getResource),
    UseInterceptors(AuditInterceptor),
  );
}