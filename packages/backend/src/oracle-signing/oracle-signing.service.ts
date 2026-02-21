import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { SignedPriceData, PricePayload, OraclePublicKeyResponse } from '../interfaces/oracle.interfaces';

/**
 * OracleSigningService
 *
 * Signs price data using Ed25519 so that the Soroban contract can verify
 * with its built-in `ed25519_verify(public_key, message, signature)`.
 *
 * Message construction (byte-perfect, matches the Rust contract):
 *   message = asset_bytes (UTF-8) ++ price_bytes (UTF-8) ++ timestamp_bytes (u64 big-endian)
 *
 * Env vars:
 *   ORACLE_PRIVATE_KEY_HEX  — 64-char hex Ed25519 private key seed
 */
@Injectable()
export class OracleSigningService implements OnModuleInit {
  private readonly logger = new Logger(OracleSigningService.name);
  private privateKey: crypto.KeyObject;
  private publicKey: crypto.KeyObject;
  private publicKeyHex: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.loadKeyPair();
  }

  // ── Key Management ─────────────────────────────────────────────────────────

  private loadKeyPair(): void {
    const hexSeed = this.configService.get<string>('ORACLE_PRIVATE_KEY_HEX');

    if (!hexSeed) {
      throw new Error(
        'ORACLE_PRIVATE_KEY_HEX is not set. Generate one with: ' +
          'node -e "const c=require(\'crypto\');console.log(c.generateKeyPairSync(\'ed25519\').privateKey.export({type:\'pkcs8\',format:\'der\'}).slice(-32).toString(\'hex\'))"',
      );
    }

    if (!/^[0-9a-fA-F]{64}$/.test(hexSeed)) {
      throw new Error('ORACLE_PRIVATE_KEY_HEX must be exactly 64 hex characters (32-byte seed)');
    }

    const seedBuffer = Buffer.from(hexSeed, 'hex');

    // Node's crypto expects a raw 32-byte seed for Ed25519
    this.privateKey = crypto.createPrivateKey({
      key: this.encodePkcs8Ed25519(seedBuffer),
      format: 'der',
      type: 'pkcs8',
    });

    this.publicKey = crypto.createPublicKey(this.privateKey);

    // Extract raw 32-byte public key for Soroban (BytesN<32>)
    const pubDer = this.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    // SPKI DER for Ed25519: last 32 bytes are the raw key
    this.publicKeyHex = pubDer.slice(-32).toString('hex');

    this.logger.log(`Oracle public key loaded: ${this.publicKeyHex}`);
  }

  /**
   * Wrap a raw 32-byte Ed25519 seed into PKCS#8 DER so Node crypto accepts it.
   * PKCS#8 header for Ed25519 is always the same 16 bytes.
   */
  private encodePkcs8Ed25519(seed: Buffer): Buffer {
    // ASN.1 PKCS#8 prefix for Ed25519 private key
    const pkcs8Header = Buffer.from(
      '302e020100300506032b657004220420',
      'hex',
    );
    return Buffer.concat([pkcs8Header, seed]);
  }

  // ── Message Construction ───────────────────────────────────────────────────

  /**
   * Constructs the canonical message bytes that the Soroban contract hashes
   * before verifying:
   *
   *   message = asset (UTF-8) | price (UTF-8) | timestamp (8 bytes, big-endian u64)
   *
   * The Rust side does:
   *   let mut msg = asset.as_bytes().to_vec();
   *   msg.extend_from_slice(price.as_bytes());
   *   msg.extend_from_slice(&timestamp.to_be_bytes());
   *   env.crypto().ed25519_verify(&pubkey, &Bytes::from_slice(&env, &msg), &sig);
   */
  buildMessage(payload: PricePayload): Buffer {
    const assetBytes = Buffer.from(payload.asset, 'utf8');
    const priceBytes = Buffer.from(payload.price, 'utf8');

    // u64 big-endian timestamp
    const tsBuf = Buffer.allocUnsafe(8);
    // JavaScript BigInt needed for safe u64 encoding
    tsBuf.writeBigUInt64BE(BigInt(payload.timestamp));

    return Buffer.concat([assetBytes, priceBytes, tsBuf]);
  }

  // ── Signing ────────────────────────────────────────────────────────────────

  /**
   * Sign a price payload and return the full SignedPriceData object.
   */
  sign(payload: PricePayload): SignedPriceData {
    const message = this.buildMessage(payload);
    const signatureBuffer = crypto.sign(null, message, this.privateKey);

    return {
      asset: payload.asset,
      price: payload.price,
      timestamp: payload.timestamp,
      signature: signatureBuffer.toString('hex'),
      publicKey: this.publicKeyHex,
    };
  }

  /**
   * Verify a signature locally (useful for testing and health checks).
   */
  verify(payload: PricePayload, signatureHex: string): boolean {
    const message = this.buildMessage(payload);
    const signature = Buffer.from(signatureHex, 'hex');
    return crypto.verify(null, message, this.publicKey, signature);
  }

  // ── Public Key Exposure ────────────────────────────────────────────────────

  getPublicKey(): OraclePublicKeyResponse {
    return { publicKey: this.publicKeyHex };
  }

  getPublicKeyHex(): string {
    return this.publicKeyHex;
  }
}
