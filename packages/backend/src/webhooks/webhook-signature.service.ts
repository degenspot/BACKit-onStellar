import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class WebhookSignatureService {
  /**
   * Create an HMAC-SHA256 signature of the payload using the subscriber's secret.
   * Returns the hex-encoded signature.
   */
  signPayload(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Verify that the received signature matches the payload for a given secret.
   * Constant-time comparison to prevent timing attacks.
   */
  verifySignature(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    const expected = this.signPayload(payload, secret);
    if (expected.length !== signature.length) {
      return false;
    }
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex'),
    );
  }

  /**
   * Generate a cryptographically random secret for a new webhook subscription.
   */
  generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}
