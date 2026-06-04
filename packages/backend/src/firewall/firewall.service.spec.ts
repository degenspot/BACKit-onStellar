import { FirewallService } from './firewall.service';
import { IpRuleType } from './entities/ip-rule.entity';
import { BlockReason } from './entities/blocked-request.entity';

describe('FirewallService', () => {
  const ruleRepo = {
    find: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => v),
    delete: jest.fn(async () => undefined),
  };
  const blockedRepo = {
    createQueryBuilder: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn(async () => ({})),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows whitelisted IPs', async () => {
    ruleRepo.find.mockResolvedValue([
      { cidr: '1.2.3.4/32', type: IpRuleType.WHITELIST },
    ]);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await service.onModuleInit();

    const verdict = await service.evaluate({
      ip: '1.2.3.4',
      method: 'GET',
      path: '/x',
      userAgent: 'Mozilla',
      headers: {},
    });

    expect(verdict).toEqual({ allowed: true });
  });

  it('blocks blacklisted IPs and records blocked request', async () => {
    ruleRepo.find.mockResolvedValue([
      { cidr: '5.6.7.8/32', type: IpRuleType.BLACKLIST },
    ]);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await service.onModuleInit();

    const verdict = await service.evaluate({
      ip: '5.6.7.8',
      method: 'GET',
      path: '/x',
      userAgent: 'Mozilla',
      headers: { accept: 'x' },
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe(BlockReason.BLACKLISTED_IP);

    // async persistence happens off the hot path
    await new Promise((r) => setImmediate(r));
    expect(blockedRepo.save).toHaveBeenCalled();
  });

  it('blocks bot user agents', async () => {
    ruleRepo.find.mockResolvedValue([]);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await service.onModuleInit();

    const verdict = await service.evaluate({
      ip: '1.1.1.1',
      method: 'GET',
      path: '/x',
      userAgent: 'Googlebot',
      headers: {},
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe(BlockReason.BOT_FINGERPRINT);
  });

  it('addRule saves and refreshes cache', async () => {
    ruleRepo.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { cidr: '9.9.9.9/32', type: IpRuleType.BLACKLIST },
      ]);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await service.onModuleInit();

    ruleRepo.create.mockReturnValue({
      cidr: '9.9.9.9/32',
      type: IpRuleType.BLACKLIST,
      reason: 'test',
      createdBy: 'me',
    } as any);
    ruleRepo.save.mockImplementation(async (v: any) => v);

    const saved = await service.addRule(
      '9.9.9.9/32',
      IpRuleType.BLACKLIST,
      'test',
      'me',
    );

    expect(saved.cidr).toBe('9.9.9.9/32');
    expect(ruleRepo.save).toHaveBeenCalled();
  });

  it('addRule supports null createdBy (system)', async () => {
    ruleRepo.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { cidr: '9.9.9.9/32', type: IpRuleType.BLACKLIST },
      ]);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await service.onModuleInit();

    ruleRepo.create.mockReturnValue({
      cidr: '9.9.9.9/32',
      type: IpRuleType.BLACKLIST,
      reason: null,
      createdBy: null,
    } as any);

    await service.addRule('9.9.9.9/32', IpRuleType.BLACKLIST, null, null);
    expect(ruleRepo.save).toHaveBeenCalled();
  });

  it('removeRule deletes and refreshes cache', async () => {
    ruleRepo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await service.onModuleInit();

    await service.removeRule('id-1');
    expect(ruleRepo.delete).toHaveBeenCalledWith('id-1');
  });

  it('whitelist takes precedence over blacklist', async () => {
    ruleRepo.find.mockResolvedValue([
      { cidr: '1.2.3.4/32', type: IpRuleType.WHITELIST },
      { cidr: '1.2.3.4/32', type: IpRuleType.BLACKLIST },
    ]);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await service.onModuleInit();

    const verdict = await service.evaluate({
      ip: '1.2.3.4',
      method: 'GET',
      path: '/x',
      userAgent: 'Mozilla',
      headers: {},
    });
    expect(verdict).toEqual({ allowed: true });
  });

  it('recordTurnstileFailure persists a TURNSTILE_FAILED entry', async () => {
    ruleRepo.find.mockResolvedValue([]);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await service.onModuleInit();

    const verdict = await service.recordTurnstileFailure({
      ip: '2.2.2.2',
      method: 'POST',
      path: '/login',
      userAgent: 'Mozilla',
      headers: { accept: 'x', authorization: 'secret', referer: 'r' },
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe(BlockReason.TURNSTILE_FAILED);

    await new Promise((r) => setImmediate(r));
    expect(blockedRepo.save).toHaveBeenCalled();
    expect(blockedRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: BlockReason.TURNSTILE_FAILED,
        headers: expect.objectContaining({ accept: 'x', referer: 'r' }),
      }),
    );
    expect(blockedRepo.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        headers: expect.objectContaining({ authorization: 'secret' }),
      }),
    );
  });

  it('persists null userAgent when missing', async () => {
    ruleRepo.find.mockResolvedValue([]);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await service.onModuleInit();

    await service.recordTurnstileFailure({
      ip: '3.3.3.3',
      method: 'GET',
      path: '/x',
      userAgent: undefined,
      headers: {},
    });

    await new Promise((r) => setImmediate(r));
    expect(blockedRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userAgent: null }),
    );
  });

  it('getRules returns repo-ordered rules', async () => {
    ruleRepo.find.mockResolvedValueOnce([{ cidr: 'x' } as any]);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await expect(service.getRules()).resolves.toEqual([{ cidr: 'x' } as any]);
    expect(ruleRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { createdAt: 'DESC' } }),
    );
  });

  it('getBlockedRequests applies optional ip and reason filters', async () => {
    const qb: any = {
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[{ id: 1 }], 1]),
    };
    blockedRepo.createQueryBuilder.mockReturnValueOnce(qb);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);

    const res = await service.getBlockedRequests(
      2,
      10,
      '1.1.1.1',
      BlockReason.BOT_FINGERPRINT,
    );
    expect(res.total).toBe(1);
    expect(qb.andWhere).toHaveBeenCalledTimes(2);
  });

  it('getBlockedRequests works without filters', async () => {
    const qb: any = {
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    blockedRepo.createQueryBuilder.mockReturnValueOnce(qb);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await expect(service.getBlockedRequests(1, 50)).resolves.toEqual({
      data: [],
      total: 0,
    });
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('getBlockedRequests uses default page/limit when omitted', async () => {
    const qb: any = {
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    blockedRepo.createQueryBuilder.mockReturnValueOnce(qb);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await service.getBlockedRequests();
    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(50);
  });

  it('does not refresh cache when within TTL', async () => {
    ruleRepo.find.mockResolvedValueOnce([]);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await service.onModuleInit();

    await service.evaluate({
      ip: '8.8.8.8',
      method: 'GET',
      path: '/ok',
      userAgent: 'Mozilla',
      headers: {},
    });
    expect(ruleRepo.find).toHaveBeenCalledTimes(1);
  });

  it('refreshes rule cache when TTL expires', async () => {
    ruleRepo.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { cidr: '5.6.7.8/32', type: IpRuleType.BLACKLIST },
      ]);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await service.onModuleInit();

    // Force cache to be "old"
    (service as any).cacheLoadedAt = Date.now() - 120_000;

    const verdict = await service.evaluate({
      ip: '5.6.7.8',
      method: 'GET',
      path: '/x',
      userAgent: 'Mozilla',
      headers: {},
    });
    expect(verdict.allowed).toBe(false);
    expect(ruleRepo.find).toHaveBeenCalledTimes(2);
  });

  it('allows requests when no rules match and UA is not a bot', async () => {
    ruleRepo.find.mockResolvedValueOnce([]);
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await service.onModuleInit();

    const verdict = await service.evaluate({
      ip: '8.8.8.8',
      method: 'GET',
      path: '/ok',
      userAgent: 'Mozilla',
      headers: {},
    });
    expect(verdict).toEqual({ allowed: true });
  });

  it('covers persist error path when blocked-request save fails', async () => {
    ruleRepo.find.mockResolvedValue([
      { cidr: '5.6.7.8/32', type: IpRuleType.BLACKLIST },
    ]);
    blockedRepo.save.mockRejectedValueOnce(new Error('db down'));
    const service = new FirewallService(ruleRepo as any, blockedRepo as any);
    await service.onModuleInit();

    const verdict = await service.evaluate({
      ip: '5.6.7.8',
      method: 'GET',
      path: '/x',
      userAgent: 'Mozilla',
      headers: {},
    });
    expect(verdict.allowed).toBe(false);
    await new Promise((r) => setImmediate(r));
  });
});
