import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import * as nacl from 'tweetnacl';
import { createHmac } from 'crypto';
import { StrKey } from '@stellar/stellar-sdk';

interface NonceEntry {
  nonce: string;
  expiresAt: number;
}

@Injectable()
export class AuthService {
  private readonly nonces = new Map<string, NonceEntry>();
  private readonly NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly JWT_SECRET =
    process.env.JWT_SECRET || 'backit-dev-secret-change-in-prod';

  generateChallenge(address: string): { nonce: string; message: string } {
    this.validateStellarAddress(address);
    const nonce = `backit-auth-${Date.now()}-${Math.random().toString(36).substring(2)}`;
    this.nonces.set(address, {
      nonce,
      expiresAt: Date.now() + this.NONCE_TTL_MS,
    });
    return {
      nonce,
      message: `Sign this message to authenticate with BACKit:\n${nonce}`,
    };
  }

  verifySignature(address: string, signature: string): { accessToken: string } {
    this.validateStellarAddress(address);

    const entry = this.nonces.get(address);
    if (!entry)
      throw new UnauthorizedException('No pending challenge for this address');
    if (Date.now() > entry.expiresAt) {
      this.nonces.delete(address);
      throw new UnauthorizedException('Challenge expired. Request a new one.');
    }

    const message = `Sign this message to authenticate with BACKit:\n${entry.nonce}`;

    try {
      const publicKeyBytes = this.stellarAddressToBytes(address);
      const messageBytes = Buffer.from(message, 'utf8');
      const sigBytes = Buffer.from(signature, 'hex');

      const valid = nacl.sign.detached.verify(
        messageBytes,
        sigBytes,
        publicKeyBytes,
      );
      if (!valid) throw new UnauthorizedException('Invalid signature');
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Signature verification failed');
    }

    this.nonces.delete(address);

    const token = this.createJwt({ sub: address });
    return { accessToken: token };
  }

  validateToken(token: string): { sub: string; iat: number; exp: number } {
    try {
      const [header, payload, sig] = token.split('.');
      if (!header || !payload || !sig) throw new Error('Malformed token');

      const expectedSig = this.hmacSign(
        `${header}.${payload}`,
        this.JWT_SECRET,
      );
      if (expectedSig !== sig) throw new Error('Invalid signature');

      const parsed: unknown = JSON.parse(
        Buffer.from(payload, 'base64url').toString(),
      );
      const obj = parsed as Record<string, unknown>;
      if (
        obj &&
        typeof obj.exp === 'number' &&
        typeof obj.sub === 'string' &&
        typeof obj.iat === 'number'
      ) {
        const decoded = {
          sub: obj.sub,
          iat: obj.iat,
          exp: obj.exp,
        };
        if (decoded.exp < Math.floor(Date.now() / 1000))
          throw new Error('Token expired');
        return decoded;
      }
      throw new Error('Malformed token payload');
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private createJwt(payload: Record<string, any>): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const body = Buffer.from(
      JSON.stringify({ ...payload, iat: now, exp: now + 86400 }),
    ).toString('base64url');
    const sig = this.hmacSign(`${header}.${body}`, this.JWT_SECRET);
    return `${header}.${body}.${sig}`;
  }

  private hmacSign(data: string, secret: string): string {
    return createHmac('sha256', secret).update(data).digest('base64url');
  }

  private stellarAddressToBytes(address: string): Uint8Array {
    // Decode Stellar address (base32 without checksum) to raw public key bytes
    return StrKey.decodeEd25519PublicKey(address);
  }

  private validateStellarAddress(address: string): void {
    if (!/^G[A-Z2-7]{54,55}$/.test(address)) {
      throw new BadRequestException('Invalid Stellar address format');
    }
  }
}
