import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { correlationStorage } from '../middleware/correlation-id.middleware';

const SENSITIVE_KEYS = [
  'signature',
  'token',
  'password',
  'secret',
  'privateKey',
];

function maskSensitive(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const masked = { ...obj };
  for (const key of SENSITIVE_KEYS) {
    if (key in masked) masked[key] = '***';
  }
  return masked;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, url } = req;
    const store = correlationStorage.getStore();
    const correlationId = store?.correlationId ?? 'unknown';
    const userAddress = req.user?.address ?? null;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse();
          const ms = Date.now() - start;
          this.logger.log(
            `[${correlationId}] ${method} ${url} ${res.statusCode} ${ms}ms${userAddress ? ` user=${userAddress}` : ''}`,
          );
        },
        error: (err) => {
          const ms = Date.now() - start;
          const status = err.status ?? 500;
          this.logger.warn(
            `[${correlationId}] ${method} ${url} ${status} ${ms}ms — ${err.message}`,
          );
        },
      }),
    );
  }
}
