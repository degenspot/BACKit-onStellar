import {
  Injectable,
  NestMiddleware,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { FirewallService } from './firewall.service';
import { extractClientIp } from './utils/ip-matcher.util';

/**
 * FirewallMiddleware
 *
 * Runs on every inbound HTTP request before it reaches any controller.
 * It is applied in AppModule.configure() so it wraps the entire app.
 *
 * Flow:
 *  1. Extract the real client IP (respects CF-Connecting-IP, X-Real-IP, X-Forwarded-For)
 *  2. Pass to FirewallService.evaluate() → checks whitelist → blacklist → bot UA
 *  3. Allowed requests pass through with next()
 *  4. Blocked requests receive a 403 JSON response with a unique error code
 *     and the request is never forwarded to controllers
 */
@Injectable()
export class FirewallMiddleware implements NestMiddleware {
  private readonly logger = new Logger(FirewallMiddleware.name);

  constructor(private readonly firewallService: FirewallService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const ip = extractClientIp({
      ip: req.ip,
      headers: req.headers as Record<string, string | string[] | undefined>,
      socket: req.socket,
    });

    const verdict = await this.firewallService.evaluate({
      ip,
      method: req.method,
      path: req.path,
      userAgent: req.headers['user-agent'],
      headers: req.headers as Record<string, string>,
    });

    if (verdict.allowed) {
      // Attach the resolved IP to the request for downstream use
      (req as Request & { clientIp: string }).clientIp = ip;
      return next();
    }

    // Return a consistent, non-revealing 403 with the trackable error code
    res.status(HttpStatus.FORBIDDEN).json({
      statusCode: HttpStatus.FORBIDDEN,
      error: 'Forbidden',
      message: 'Access denied.',
      errorCode: verdict.errorCode,
    });
  }
}