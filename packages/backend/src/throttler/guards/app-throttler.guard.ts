import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const user = (req as any).user;
    if (user?.id) return `user_${user.id}`;
    if (user?.address) return `user_${user.address}`;
    return req.ip ?? req.socket.remoteAddress ?? 'unknown';
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: any,
  ): Promise<void> {
    const response = context.switchToHttp().getResponse<Response>();
    const retryAfter = Math.ceil(throttlerLimitDetail.timeToExpire / 1000);
    response.setHeader('Retry-After', retryAfter);
    throw new ThrottlerException(
      `Too Many Requests. Retry after ${retryAfter}s.`,
    );
  }
}
