import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { FirewallService } from '../firewall.service';
import { extractClientIp } from '../utils/ip-matcher.util';

export const SKIP_TURNSTILE_KEY = 'skipTurnstile';

/**
 * @SkipTurnstile()
 * Apply to routes that should bypass the Turnstile check (e.g. mobile-only flows).
 */
export const SkipTurnstile = () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@nestjs/common').SetMetadata(SKIP_TURNSTILE_KEY, true);

/**
 * TurnstileGuard
 *
 * Validates the Cloudflare Turnstile token sent in the request header
 * `x-turnstile-token` against Cloudflare's siteverify API.
 *
 * Apply globally or per-controller:
 *
 * @example
 * // Global — in main.ts after app creation:
 * app.useGlobalGuards(app.get(TurnstileGuard));
 *
 * @example
 * // Per-controller:
 * @UseGuards(TurnstileGuard)
 * @Controller('markets')
 * export class MarketsController { ... }
 *
 * Required env vars:
 *   TURNSTILE_SECRET_KEY  — Cloudflare Turnstile secret key
 *   TURNSTILE_ENABLED     — set to "false" to disable in development
 */
@Injectable()
export class TurnstileGuard implements CanActivate {
  private readonly logger = new Logger(TurnstileGuard.name);
  private readonly SITEVERIFY_URL =
    'https://challenges.cloudflare.com/turnstile/v0/siteverify';

  constructor(
    private readonly configService: ConfigService,
    private readonly firewallService: FirewallService,
    private readonly reflector: Reflector,
  ) { }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Allow opt-out via @SkipTurnstile()
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TURNSTILE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return true;

    // Allow disabling in development
    const enabled = this.configService.get<string>('TURNSTILE_ENABLED') !== 'false';
    if (!enabled) return true;

    const secretKey = this.configService.get<string>('TURNSTILE_SECRET_KEY');
    if (!secretKey) {
      this.logger.warn('TURNSTILE_SECRET_KEY not set — skipping Turnstile verification');
      return true;
    }

    const req = ctx.switchToHttp().getRequest<Request>();
    const token =
      (req.headers['x-turnstile-token'] as string | undefined) ??
      (req.body as Record<string, string>)?.['cf-turnstile-response'];

    const ip = extractClientIp({
      ip: req.ip,
      headers: req.headers as Record<string, string | string[] | undefined>,
      socket: req.socket,
    });

    if (!token) {
      await this.firewallService.recordTurnstileFailure({
        ip,
        method: req.method,
        path: req.path,
        userAgent: req.headers['user-agent'],
        headers: req.headers as Record<string, string>,
      });
      throw new ForbiddenException({
        message: 'Bot challenge token missing.',
        hint: 'Include a valid Cloudflare Turnstile token in the x-turnstile-token header.',
      });
    }

    const verified = await this.verifyToken(token, secretKey, ip);

    if (!verified) {
      const verdict = await this.firewallService.recordTurnstileFailure({
        ip,
        method: req.method,
        path: req.path,
        userAgent: req.headers['user-agent'],
        headers: req.headers as Record<string, string>,
      });

      throw new ForbiddenException({
        message: 'Bot challenge verification failed.',
        errorCode: verdict.errorCode,
      });
    }

    return true;
  }

  private async verifyToken(
    token: string,
    secretKey: string,
    remoteIp: string,
  ): Promise<boolean> {
    try {
      const body = new URLSearchParams({
        secret: secretKey,
        response: token,
        remoteip: remoteIp,
      });

      const res = await fetch(this.SITEVERIFY_URL, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const data = (await res.json()) as { success: boolean; 'error-codes'?: string[] };

      if (!data.success) {
        this.logger.debug(`Turnstile rejected: ${data['error-codes']?.join(', ')}`);
      }

      return data.success;
    } catch (err) {
      this.logger.error('Turnstile siteverify request failed', (err as Error).message);
      // Fail open on network error to avoid locking out legitimate users
      return true;
    }
  }
}