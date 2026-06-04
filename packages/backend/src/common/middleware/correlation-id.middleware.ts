import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';

export const correlationStorage = new AsyncLocalStorage<{
  correlationId: string;
}>();

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    res.setHeader('X-Correlation-ID', correlationId);

    correlationStorage.run({ correlationId }, () => next());
  }
}
