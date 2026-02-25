import { Observable, throwError, timer } from 'rxjs';
import { mergeMap, retryWhen } from 'rxjs/operators';

const DEFAULT_MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1000;

// ─── Async/Await: @Retryable Decorator ────────────────────────────────────────

export function Retryable(
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs: number = BASE_DELAY_MS,
): MethodDecorator {
  return function (
    _target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    descriptor.value = async function (...args: unknown[]): Promise<unknown> {
      return retryWithBackoff(
        () => originalMethod.apply(this, args),
        maxAttempts,
        baseDelayMs,
        String(propertyKey),
      );
    };

    return descriptor;
  };
}

// ─── Async/Await: Standalone Helper ───────────────────────────────────────────

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs: number = BASE_DELAY_MS,
  label = 'RPC call',
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts) {
        console.error(
          `[Retry] ${label} failed after ${maxAttempts} attempts. Giving up.`,
          err,
        );
        break;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1); // 1s, 2s, 4s, 8s
      console.warn(
        `[Retry] ${label} attempt ${attempt}/${maxAttempts} failed. Retrying in ${delayMs}ms...`,
        (err as Error)?.message ?? err,
      );

      await sleep(delayMs);
    }
  }

  throw lastError;
}

// ─── RxJS: Exponential Backoff Retry Operator ─────────────────────────────────

export function rxjsRetryWithBackoff<T>(
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs: number = BASE_DELAY_MS,
  label = 'RPC observable',
) {
  return (source: Observable<T>): Observable<T> => {
    let attempt = 0;

    return source.pipe(
      retryWhen((errors) =>
        errors.pipe(
          mergeMap((err) => {
            attempt += 1;

            if (attempt >= maxAttempts) {
              console.error(
                `[Retry] ${label} failed after ${maxAttempts} attempts. Giving up.`,
                err,
              );
              return throwError(() => err as Error);
            }

            const delayMs = baseDelayMs * Math.pow(2, attempt - 1); // 1s, 2s, 4s, 8s
            console.warn(
              `[Retry] ${label} attempt ${attempt}/${maxAttempts} failed. Retrying in ${delayMs}ms...`,
              (err as Error)?.message ?? err,
            );

            return timer(delayMs);
          }),
        ),
      ),
    );
  };
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
