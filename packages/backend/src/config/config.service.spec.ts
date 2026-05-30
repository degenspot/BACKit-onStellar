import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from './config.service';
import { PlatformSettings } from './entities/platform-settings.entity';

describe('ConfigService', () => {
  let service: ConfigService;

  const repo = {
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };
  const cache = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };
  const eventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigService,
        { provide: getRepositoryToken(PlatformSettings), useValue: repo },
        { provide: CACHE_MANAGER, useValue: cache },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<ConfigService>(ConfigService);
  });

  it('returns cached config when present', async () => {
    cache.get.mockResolvedValue({ feePercent: 2.5 });
    const result = await service.getSettings();
    expect(result).toEqual({ feePercent: 2.5 });
    expect(repo.findOneOrFail).not.toHaveBeenCalled();
  });

  it('updates config and emits websocket refresh event', async () => {
    const row = {
      id: 1,
      feePercent: 1,
      minStake: 0,
      maxDuration: 100,
      supportedTokens: [],
      contractAddresses: {},
    };
    cache.get.mockResolvedValue(null);
    repo.findOneOrFail.mockResolvedValue(row);
    repo.save.mockImplementation(async (value: any) => value);

    const result = await service.updateOffChainSettings({
      feePercent: 3,
      minStake: 10,
    });

    expect(result.feePercent).toBe(3);
    expect(result.minStake).toBe(10);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'config.updated',
      expect.objectContaining({ source: 'admin' }),
    );
  });
});
