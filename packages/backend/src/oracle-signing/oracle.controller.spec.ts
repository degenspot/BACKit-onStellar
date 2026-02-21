import { Test, TestingModule } from '@nestjs/testing';
import { OracleController } from '../oracle.controller';
import { OracleSigningService } from '../services/oracle-signing.service';
import { SignPriceDto } from '../dto/sign-price.dto';
import { SignedPriceData, OraclePublicKeyResponse } from '../interfaces/oracle.interfaces';

const MOCK_PUBLIC_KEY = 'a'.repeat(64);

const mockSigningService: jest.Mocked<Partial<OracleSigningService>> = {
  getPublicKey: jest.fn((): OraclePublicKeyResponse => ({ publicKey: MOCK_PUBLIC_KEY })),
  sign: jest.fn((payload): SignedPriceData => ({
    asset: payload.asset,
    price: payload.price,
    timestamp: payload.timestamp,
    signature: 'b'.repeat(128),
    publicKey: MOCK_PUBLIC_KEY,
  })),
};

describe('OracleController', () => {
  let controller: OracleController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OracleController],
      providers: [{ provide: OracleSigningService, useValue: mockSigningService }],
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
    const dto: SignPriceDto = { asset: 'BTC_USD', price: '65000.00', timestamp: 1700000000 };

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
