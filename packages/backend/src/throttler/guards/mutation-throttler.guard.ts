import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';
import {
  THROTTLER_MUTATION_NAME,
  THROTTLER_MUTATION_TTL,
  THROTTLER_MUTATION_LIMIT,
} from '../throttler.constants';

@Injectable()
export class MutationThrottlerGuard extends ThrottlerGuard {
  protected throttlers = [
    {
      name: THROTTLER_MUTATION_NAME,
      ttl: THROTTLER_MUTATION_TTL,
      limit: THROTTLER_MUTATION_LIMIT,
    },
  ];

  protected async getTracker(req: Request): Promise<string> {
    const user = (req as any).user;
    if (user?.id) return `mutation_user_${user.id}`;
    if (user?.address) return `mutation_user_${user.address}`;
    return `mutation_ip_${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: any,
  ): Promise<void> {
    const response = context.switchToHttp().getResponse<Response>();
    const retryAfter = Math.ceil(throttlerLimitDetail.timeToExpire / 1000);
    response.setHeader('Retry-After', retryAfter);
    throw new ThrottlerException(
      `Mutation rate limit exceeded. Retry after ${retryAfter}s.`,
    );
  }
}
