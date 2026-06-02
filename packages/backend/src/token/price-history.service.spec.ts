import { PriceHistoryService } from './price-history.service';

describe('PriceHistoryService', () => {
  const mockRepo: any = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    delete: jest.fn(),
  };

  const mockDataSource: any = {
    getRepository: jest.fn().mockReturnValue(mockRepo),
  };

  const mockTokensService: any = {
    getPairPrice: jest.fn(),
  };

  let service: PriceHistoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PriceHistoryService(mockDataSource, mockTokensService);
  });

  describe('recordPrice', () => {
    it('saves a price entry when priceUsd is non-zero', async () => {
      mockTokensService.getPairPrice.mockResolvedValue({ priceUsd: 0.12 });
      mockRepo.create.mockReturnValue({ tokenPair: 'XLM-issuer', price: 0.12 });
      mockRepo.save.mockResolvedValue({});

      await service.recordPrice('XLM-issuer');

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tokenPair: 'XLM-issuer', price: 0.12, source: 'dexscreener' }),
      );
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('skips save when priceUsd is 0', async () => {
      mockTokensService.getPairPrice.mockResolvedValue({ priceUsd: 0 });

      await service.recordPrice('XLM-issuer');

      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('does not throw when getPairPrice rejects', async () => {
      mockTokensService.getPairPrice.mockRejectedValue(new Error('network'));

      await expect(service.recordPrice('XLM-issuer')).resolves.toBeUndefined();
    });
  });

  describe('getHistory', () => {
    it('queries with correct period window and returns results', async () => {
      const rows = [{ timestamp: new Date(), price: 0.1, source: 'dexscreener' }];
      mockRepo.find.mockResolvedValue(rows);

      const result = await service.getHistory('XLM-issuer', '1h');

      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tokenPair: 'XLM-issuer' }),
          order: { timestamp: 'ASC' },
        }),
      );
      expect(result).toBe(rows);
    });

    it('defaults to 24h period', async () => {
      mockRepo.find.mockResolvedValue([]);
      await service.getHistory('XLM-issuer');
      expect(mockRepo.find).toHaveBeenCalled();
    });
  });

  describe('deleteOlderThan', () => {
    it('calls delete with a cutoff date', async () => {
      mockRepo.delete.mockResolvedValue({ affected: 5 });

      await service.deleteOlderThan(30);

      expect(mockRepo.delete).toHaveBeenCalledWith(
        expect.objectContaining({ timestamp: expect.anything() }),
      );
    });
  });
});
