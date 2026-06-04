import { AuthService } from './auth.service';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    service = new AuthService();
  });

  describe('generateChallenge', () => {
    it('returns a nonce and message for a valid address', () => {
      const address = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZW5BQNL3QJBA4RDHKHRD';
      const result = service.generateChallenge(address);
      expect(result.nonce).toMatch(/^backit-auth-/);
      expect(result.message).toContain(result.nonce);
    });

    it('throws BadRequestException for invalid address', () => {
      expect(() => service.generateChallenge('invalid')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('verifySignature', () => {
    it('throws UnauthorizedException when no challenge exists', () => {
      const address = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZW5BQNL3QJBA4RDHKHRD';
      expect(() => service.verifySignature(address, 'deadsig')).toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when challenge is expired', () => {
      const address = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZW5BQNL3QJBA4RDHKHRD';
      service.generateChallenge(address);
      // Manually expire
      (service as any).nonces.set(address, {
        nonce: 'x',
        expiresAt: Date.now() - 1,
      });
      expect(() => service.verifySignature(address, 'deadsig')).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('validateToken', () => {
    it('throws UnauthorizedException for a malformed token', () => {
      expect(() => service.validateToken('not.a.token')).toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for an expired token', () => {
      const past = Math.floor(Date.now() / 1000) - 10;
      const header = Buffer.from(
        JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ sub: 'G123', iat: past - 100, exp: past }),
      ).toString('base64url');
      expect(() =>
        service.validateToken(`${header}.${payload}.badsig`),
      ).toThrow(UnauthorizedException);
    });
  });
});
