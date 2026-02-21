import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as crypto from 'crypto';
import { ConfigModule } from '@nestjs/config';
import { OracleModule } from '../oracle.module';

// Generate a deterministic test key
const { privateKey: _testPrivateKey } = crypto.generateKeyPairSync('ed25519');
const testPrivateKeyHex = (_testPrivateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer)
  .slice(-32)
  .toString('hex');

describe('Oracle E2E', () => {
  let app: INestApplication;
  let publicKeyHex: string;

  beforeAll(async () => {
    process.env.ORACLE_PRIVATE_KEY_HEX = testPrivateKeyHex;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        OracleModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.ORACLE_PRIVATE_KEY_HEX;
  });

  // ── GET /oracle/public-key ──────────────────────────────────────────────────

  describe('GET /oracle/public-key', () => {
    it('returns 200 with a 64-char hex public key', async () => {
      const res = await request(app.getHttpServer()).get('/oracle/public-key').expect(200);
      expect(res.body.publicKey).toMatch(/^[0-9a-f]{64}$/);
      publicKeyHex = res.body.publicKey; // save for subsequent assertions
    });
  });

  // ── POST /oracle/sign ───────────────────────────────────────────────────────

  describe('POST /oracle/sign', () => {
    const validBody = { asset: 'BTC_USD', price: '65000.50', timestamp: 1700000000 };

    it('returns 200 with a fully signed payload', async () => {
      const res = await request(app.getHttpServer())
        .post('/oracle/sign')
        .send(validBody)
        .expect(200);

      expect(res.body.asset).toBe(validBody.asset);
      expect(res.body.price).toBe(validBody.price);
      expect(res.body.timestamp).toBe(validBody.timestamp);
      expect(res.body.signature).toMatch(/^[0-9a-f]{128}$/);
      expect(res.body.publicKey).toBe(publicKeyHex);
    });

    it('signature is cryptographically valid (Node verify)', async () => {
      const res = await request(app.getHttpServer())
        .post('/oracle/sign')
        .send(validBody)
        .expect(200);

      const { signature, publicKey } = res.body;

      // Reconstruct message bytes (mirrors the service logic)
      const assetB = Buffer.from(validBody.asset, 'utf8');
      const priceB = Buffer.from(validBody.price, 'utf8');
      const tsB = Buffer.allocUnsafe(8);
      tsB.writeBigUInt64BE(BigInt(validBody.timestamp));
      const message = Buffer.concat([assetB, priceB, tsB]);

      // Rebuild public key object from raw 32-byte hex
      const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
      const rawPub = Buffer.from(publicKey, 'hex');
      const pubKeyObj = crypto.createPublicKey({
        key: Buffer.concat([spkiHeader, rawPub]),
        format: 'der',
        type: 'spki',
      });

      const isValid = crypto.verify(null, message, pubKeyObj, Buffer.from(signature, 'hex'));
      expect(isValid).toBe(true);
    });

    it('is deterministic – same input yields same signature', async () => {
      const [r1, r2] = await Promise.all([
        request(app.getHttpServer()).post('/oracle/sign').send(validBody),
        request(app.getHttpServer()).post('/oracle/sign').send(validBody),
      ]);
      expect(r1.body.signature).toBe(r2.body.signature);
    });

    // ── Validation errors ──────────────────────────────────────────────────────

    it('rejects missing asset with 400', async () => {
      await request(app.getHttpServer())
        .post('/oracle/sign')
        .send({ price: '1.00', timestamp: 1700000000 })
        .expect(400);
    });

    it('rejects lowercase asset with 400', async () => {
      await request(app.getHttpServer())
        .post('/oracle/sign')
        .send({ asset: 'btc_usd', price: '1.00', timestamp: 1700000000 })
        .expect(400);
    });

    it('rejects negative price string with 400', async () => {
      await request(app.getHttpServer())
        .post('/oracle/sign')
        .send({ asset: 'BTC_USD', price: '-1.00', timestamp: 1700000000 })
        .expect(400);
    });

    it('rejects missing timestamp with 400', async () => {
      await request(app.getHttpServer())
        .post('/oracle/sign')
        .send({ asset: 'BTC_USD', price: '1.00' })
        .expect(400);
    });

    it('rejects zero timestamp with 400', async () => {
      await request(app.getHttpServer())
        .post('/oracle/sign')
        .send({ asset: 'BTC_USD', price: '1.00', timestamp: 0 })
        .expect(400);
    });

    it('rejects extra unknown fields with 400 (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .post('/oracle/sign')
        .send({ ...validBody, hack: 'injection' })
        .expect(400);
    });
  });
});
