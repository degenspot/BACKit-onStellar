import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { AuditService } from '../audit.service';
import { AuditActionType, AuditStatus } from '../audit-log.entity';
import {
  AUDIT_ACTION_KEY,
  AUDIT_RESOURCE_KEY,
} from '../decorators/audited.decorator';

/**
 * AuditInterceptor
 *
 * This interceptor is NOT registered globally. It is applied selectively via
 * the @Audited() decorator on individual admin route handlers.
 *
 * Lifecycle:
 *   1. Intercepts the inbound request → snapshots the body.
 *   2. Lets the handler run normally.
 *   3. On success: writes a SUCCESS log entry with the response payload.
 *   4. On error:   writes a FAILURE log entry with the error details, then
 *                  re-throws so the exception filter still handles the HTTP response.
 *
 * Actor resolution order:
 *   req.user.id → req.user.sub → req.user.address → req.user.email → 'unknown'
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const actionType = this.reflector.get<AuditActionType>(
      AUDIT_ACTION_KEY,
      ctx.getHandler(),
    );

    // If the decorator wasn't applied (defensive check), skip silently
    if (!actionType) return next.handle();

    const req: Request & { user?: Record<string, string> } = ctx
      .switchToHttp()
      .getRequest();

    const res: Response = ctx.switchToHttp().getResponse();

    // ── Actor ─────────────────────────────────────────────────────────────
    const user = req.user ?? {};
    const actorId =
      user['id'] ??
      user['sub'] ??
      user['address'] ??
      user['email'] ??
      'unknown';

    // ── Target Resource ───────────────────────────────────────────────────
    const getResource = this.reflector.get<
      ((c: ExecutionContext) => string) | undefined
    >(AUDIT_RESOURCE_KEY, ctx.getHandler());

    const targetResource = getResource
      ? getResource(ctx)
      : (req.path ?? ctx.getHandler().name);

    // ── Request payload snapshot (strip sensitive fields) ─────────────────
    const requestPayload = sanitize(req.body as Record<string, unknown>);

    const startedAt = Date.now();

    return next.handle().pipe(
      // ── SUCCESS path ────────────────────────────────────────────────────
      tap((responseBody: unknown) => {
        void this.auditService.write({
          actorId,
          actionType,
          targetResource,
          requestPayload,
          responsePayload: sanitize(responseBody as Record<string, unknown>),
          httpStatus: res.statusCode,
          status: AuditStatus.SUCCESS,
        });

        this.logger.debug(
          `Audit [${actionType}] actor=${actorId} resource="${targetResource}" ` +
            `status=SUCCESS http=${res.statusCode} duration=${Date.now() - startedAt}ms`,
        );
      }),

      // ── FAILURE path ─────────────────────────────────────────────────────
      catchError((err: Error & { status?: number; response?: unknown }) => {
        const httpStatus = err.status ?? 500;

        void this.auditService.write({
          actorId,
          actionType,
          targetResource,
          requestPayload,
          responsePayload: {
            error: err.message,
            detail: sanitize(err.response as Record<string, unknown>),
          },
          httpStatus,
          status: AuditStatus.FAILURE,
          note: err.message,
        });

        this.logger.warn(
          `Audit [${actionType}] actor=${actorId} resource="${targetResource}" ` +
            `status=FAILURE http=${httpStatus} error="${err.message}"`,
        );

        return throwError(() => err); // re-throw so the exception filter handles HTTP response
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'privateKey',
  'mnemonic',
  'seed',
  'authorization',
]);

/**
 * Recursively strips known sensitive keys from an object before storing it.
 * Returns null for non-object values to avoid giant response blobs.
 */
function sanitize(
  value: Record<string, unknown> | unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || depth > 4) return null;

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      result[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      result[k] = sanitize(v as Record<string, unknown>, depth + 1);
    } else {
      result[k] = v;
    }
  }
  return result;
}
