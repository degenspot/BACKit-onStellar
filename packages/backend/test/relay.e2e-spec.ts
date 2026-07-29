import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { RelayModule } from '../src/relay/relay.module';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { CacheModule } from '@nestjs/cache-manager';
import { AppThrottlerModule } from '../src/throttler/throttler.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlatformSettings } from '../src/config/entities/platform-settings.entity';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

describe('RelayController (e2e)', () => {
  let app: INestApplication;

  const mockRpcServer = {
    simulateTransaction: jest.fn().mockResolvedValue({
      minResourceFee: '1000',
    }),
  };

  const mockPlatformSettingsRepository = {
    findOne: jest.fn().mockResolvedValue({ contractId: 'ALLOWED' }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        CacheModule.register({ isGlobal: true }),
        AppThrottlerModule,
        RelayModule,
      ],
    })
      .overrideProvider(SorobanRpc.Server)
      .useValue(mockRpcServer)
      .overrideProvider(getRepositoryToken(PlatformSettings))
      .useValue(mockPlatformSettingsRepository)
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('/relay/simulate (POST) returns 400 when XDR is missing', async () => {
    await request(app.getHttpServer())
      .post('/relay/simulate')
      .send({})
      .expect(400);
  });
});
