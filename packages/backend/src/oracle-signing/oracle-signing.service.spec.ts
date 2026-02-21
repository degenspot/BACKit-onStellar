import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { OracleSigningService } from '../services/oracle-signing.service';
import { PricePayload } from '../interfaces/oracle.interfaces';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a fresh 32-byte Ed25519 seed as hex (for test isolation). */
function generateTestKeyHex(): string {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const der = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
  return der.slice(-32).toString('hex');
}

const TEST_PRIVATE_KEY_HEX = generateTestKeyHex();

function buildConfigService(keyHex = TEST_PRIVATE_KEY_HEX): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'ORACLE_PRIVATE_KEY_HEX') return keyHex;
      return undefined;
    }),
  } as unknown as ConfigService;
}

async function buildService(configService: ConfigService): Promise<OracleSigningService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OracleSigningService,
      { provide: ConfigService, useValue: configService },
    ],
  }).compile();

  const service = module.get<OracleSigningService>(OracleSigningService);
  service.onModuleInit(); // trigger key loading
  return service;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OracleSigningService', () => {
  let service: OracleSigningService;

  beforeEach(async () => {
    service = await buildService(buildConfigService());
  });

  // ── Initialisation ──────────────────────────────────────────────────────────

  describe('onModuleInit / key loading', () => {
    it('loads successfully with a valid 64-char hex seed', () => {
      expect(service.getPublicKeyHex()).toMatch(/^[0-9a-f]{64}$/);
    });

    it('throws when ORACLE_PRIVATE_KEY_HEX is missing', async () => {
      const bad = buildConfigService('');
      // override get to return undefined
      (bad.get as jest.Mock).mockReturnValue(undefined);
      const svc = new OracleSigningService(bad);
      expect(() => svc.onModuleInit()).toThrow('ORACLE_PRIVATE_KEY_HEX is not set');
    });

    it('throws when key is wrong length', async () => {
      const svc = new OracleSigningService(buildConfigService('deadbeef'));
      expect(() => svc.onModuleInit()).toThrow('must be exactly 64 hex characters');
    });

    it('throws when key contains non-hex characters', async () => {
      const invalid = 'z'.repeat(64);
      const svc = new OracleSigningService(buildConfigService(invalid));
      expect(() => svc.onModuleInit()).toThrow('must be exactly 64 hex characters');
    });

    it('exposes a 64-char hex public key (32 bytes)', () => {
      const pk = service.getPublicKeyHex();
      expect(pk).toHaveLength(64);
      expect(pk).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns consistent public key across multiple getPublicKey() calls', () => {
      expect(service.getPublicKey().publicKey).toBe(service.getPublicKey().publicKey);
    });
  });

  // ── Message Construction ────────────────────────────────────────────────────

  describe('buildMessage', () => {
    const payload: PricePayload = { asset: 'BTC_USD', price: '65000.50', timestamp: 1700000000 };

    it('produces a Buffer', () => {
      expect(service.buildMessage(payload)).toBeInstanceOf(Buffer);
    });

    it('encodes asset as UTF-8 prefix', () => {
      const msg = service.buildMessage(payload);
      const assetBytes = Buffer.from('BTC_USD', 'utf8');
      expect(msg.slice(0, assetBytes.length)).toEqual(assetBytes);
    });

    it('encodes price after asset', () => {
      const msg = service.buildMessage(payload);
      const assetLen = Buffer.from('BTC_USD', 'utf8').length;
      const priceBytes = Buffer.from('65000.50', 'utf8');
      expect(msg.slice(assetLen, assetLen + priceBytes.length)).toEqual(priceBytes);
    });

    it('encodes timestamp as 8-byte big-endian u64 at the end', () => {
      const msg = service.buildMessage(payload);
      const tsBytes = msg.slice(-8);
      const expected = Buffer.allocUnsafe(8);
      expected.writeBigUInt64BE(BigInt(1700000000));
      expect(tsBytes).toEqual(expected);
    });

    it('total length = asset_len + price_len + 8', () => {
      const msg = service.buildMessage(payload);
      const expected =
        Buffer.from('BTC_USD', 'utf8').length +
        Buffer.from('65000.50', 'utf8').length +
        8;
      expect(msg.length).toBe(expected);
    });

    it('produces different messages for different assets', () => {
      const a = service.buildMessage({ ...payload, asset: 'ETH_USD' });
      const b = service.buildMessage({ ...payload, asset: 'BTC_USD' });
      expect(a).not.toEqual(b);
    });

    it('produces different messages for different prices', () => {
      const a = service.buildMessage({ ...payload, price: '1.00' });
      const b = service.buildMessage({ ...payload, price: '2.00' });
      expect(a).not.toEqual(b);
    });

    it('produces different messages for different timestamps', () => {
      const a = service.buildMessage({ ...payload, timestamp: 1 });
      const b = service.buildMessage({ ...payload, timestamp: 2 });
      expect(a).not.toEqual(b);
    });

    it('is deterministic – same input produces same bytes', () => {
      expect(service.buildMessage(payload)).toEqual(service.buildMessage(payload));
    });
  });

  // ── Signing ─────────────────────────────────────────────────────────────────

  describe('sign', () => {
    const payload: PricePayload = { asset: 'XLM_USD', price: '0.11', timestamp: 1700500000 };

    it('returns asset, price, timestamp unchanged', () => {
      const result = service.sign(payload);
      expect(result.asset).toBe(payload.asset);
      expect(result.price).toBe(payload.price);
      expect(result.timestamp).toBe(payload.timestamp);
    });

    it('returns a 128-char hex signature (64 bytes = Ed25519)', () => {
      const { signature } = service.sign(payload);
      expect(signature).toHaveLength(128);
      expect(signature).toMatch(/^[0-9a-f]{128}$/);
    });

    it('returns the correct public key in the signed object', () => {
      const result = service.sign(payload);
      expect(result.publicKey).toBe(service.getPublicKeyHex());
    });

    it('is deterministic – signing the same payload twice gives the same signature', () => {
      // Ed25519 is deterministic (RFC 8032)
      expect(service.sign(payload).signature).toBe(service.sign(payload).signature);
    });

    it('produces different signatures for different payloads', () => {
      const a = service.sign({ ...payload, price: '0.10' });
      const b = service.sign({ ...payload, price: '0.12' });
      expect(a.signature).not.toBe(b.signature);
    });
  });

  // ── Verification ────────────────────────────────────────────────────────────

  describe('verify', () => {
    const payload: PricePayload = { asset: 'BTC_USD', price: '65000.00', timestamp: 1700000000 };

    it('returns true for a valid self-signed payload', () => {
      const { signature } = service.sign(payload);
      expect(service.verify(payload, signature)).toBe(true);
    });

    it('returns false for a tampered price', () => {
      const { signature } = service.sign(payload);
      expect(service.verify({ ...payload, price: '99999.00' }, signature)).toBe(false);
    });

    it('returns false for a tampered asset', () => {
      const { signature } = service.sign(payload);
      expect(service.verify({ ...payload, asset: 'ETH_USD' }, signature)).toBe(false);
    });

    it('returns false for a tampered timestamp', () => {
      const { signature } = service.sign(payload);
      expect(service.verify({ ...payload, timestamp: 1 }, signature)).toBe(false);
    });

    it('returns false for a random garbage signature', () => {
      const garbage = Buffer.alloc(64).toString('hex');
      expect(service.verify(payload, garbage)).toBe(false);
    });

    it('returns false when signature is all zeros', () => {
      const zeros = '0'.repeat(128);
      expect(service.verify(payload, zeros)).toBe(false);
    });
  });

  // ── Cross-instance compatibility ────────────────────────────────────────────

  describe('cross-instance', () => {
    it('a signature from one instance verifies on another instance with the same key', async () => {
      const service2 = await buildService(buildConfigService(TEST_PRIVATE_KEY_HEX));
      const payload: PricePayload = { asset: 'ETH_USD', price: '3200.00', timestamp: 1700000000 };

      const { signature } = service.sign(payload);
      expect(service2.verify(payload, signature)).toBe(true);
    });

    it('a signature from one key does NOT verify with a different key', async () => {
      const otherKeyHex = generateTestKeyHex();
      const service2 = await buildService(buildConfigService(otherKeyHex));
      const payload: PricePayload = { asset: 'ETH_USD', price: '3200.00', timestamp: 1700000000 };

      const { signature } = service.sign(payload);
      expect(service2.verify(payload, signature)).toBe(false);
    });
  });

  // ── Native crypto compatibility (Soroban parity) ────────────────────────────

  describe('Soroban ed25519_verify parity', () => {
    it('Node crypto verify() agrees with the service verify()', () => {
      const payload: PricePayload = { asset: 'XLM_USD', price: '0.11', timestamp: 1700500000 };
      const { signature, publicKey } = service.sign(payload);
      const message = service.buildMessage(payload);

      // Reconstruct public key object from raw hex – same as Soroban extracting BytesN<32>
      const rawPub = Buffer.from(publicKey, 'hex');
      // SPKI DER prefix for Ed25519 (12 bytes fixed)
      const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
      const spkiDer = Buffer.concat([spkiHeader, rawPub]);
      const pubKeyObj = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });

      const isValid = crypto.verify(null, message, pubKeyObj, Buffer.from(signature, 'hex'));
      expect(isValid).toBe(true);
    });
  });
});
