import { Test, TestingModule } from '@nestjs/testing';
import { OracleController } from './oracle.controller';
import { OracleSigningService } from './oracle-signing.service';
import { SignPriceDto } from './sign-price.dto';
import { SignedPriceData, OraclePublicKeyResponse } from './oracle.interfaces';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUE_ORACLE_SIGNING } from '../common/queues/queues.constants';

const MOCK_PUBLIC_KEY = 'a'.repeat(64);

const mockSigningService: jest.Mocked<Partial<OracleSigningService>> = {
  getPublicKey: jest.fn(
    (): OraclePublicKeyResponse => ({ publicKey: MOCK_PUBLIC_KEY }),
  ),
  sign: jest.fn(
    (payload): SignedPriceData => ({
      asset: payload.asset,
      price: payload.price,
      timestamp: payload.timestamp,
      signature: 'b'.repeat(128),
      publicKey: MOCK_PUBLIC_KEY,
    }),
  ),
};

describe('OracleController', () => {
  let controller: OracleController;
  const mockQueue = {
    add: jest.fn(),
    getJob: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OracleController],
      providers: [
        { provide: OracleSigningService, useValue: mockSigningService },
        { provide: getQueueToken(QUEUE_ORACLE_SIGNING), useValue: mockQueue },
      ],
    }).compile();

    controller = module.get<OracleController>(OracleController);
    jest.clearAllMocks();
  });

  describe('GET /oracle/public-key', () => {
    it('returns the public key from the service', () => {
      const result = controller.getPublicKey();
      expect(result).toEqual({ publicKey: MOCK_PUBLIC_KEY });
      expect(mockSigningService.getPublicKey).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /oracle/sign', () => {
    const dto: SignPriceDto = {
      asset: 'BTC_USD',
      price: '65000.00',
      timestamp: 1700000000,
    };

    it('delegates to the signing service with correct payload', () => {
      controller.signPrice(dto);
      expect(mockSigningService.sign).toHaveBeenCalledWith({
        asset: dto.asset,
        price: dto.price,
        timestamp: dto.timestamp,
      });
    });

    it('returns the signed data object', () => {
      const result = controller.signPrice(dto);
      expect(result.asset).toBe(dto.asset);
      expect(result.price).toBe(dto.price);
      expect(result.timestamp).toBe(dto.timestamp);
      expect(result.signature).toHaveLength(128);
      expect(result.publicKey).toBe(MOCK_PUBLIC_KEY);
    });
  });
});
