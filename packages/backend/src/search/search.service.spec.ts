import { SearchService } from './search.service';

describe('SearchService', () => {
  it('returns grouped calls and users', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'c1', title: 'BTC rally' }])
        .mockResolvedValueOnce([{ id: 'u1', walletAddress: 'GBABC' }]),
    };

    const service = new SearchService(dataSource as any);
    const result = await service.globalSearch('btc ral');

    expect(result).toEqual({
      calls: [{ id: 'c1', title: 'BTC rally' }],
      users: [{ id: 'u1', walletAddress: 'GBABC' }],
    });
  });

  it('returns empty groups for empty query', async () => {
    const dataSource = { query: jest.fn() };
    const service = new SearchService(dataSource as any);
    const result = await service.globalSearch('   ');
    expect(result).toEqual({ calls: [], users: [] });
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
