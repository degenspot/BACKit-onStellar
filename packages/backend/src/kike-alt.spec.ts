import { AdminGuard } from './auth/guards/admin.guard';
import { defaultCacheConfigOptions } from './cache/cache.config';

describe('kike-alt Backend Features (#452, #184)', () => {
  it('AdminGuard rejects non-admin users', () => {
    const guard = new AdminGuard();
    const mockCtxNonAdmin: any = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { isAdmin: false, role: 'user' } }),
      }),
    };
    expect(() => guard.canActivate(mockCtxNonAdmin)).toThrow(
      'Admin privileges required',
    );
  });

  it('AdminGuard permits admin users', () => {
    const guard = new AdminGuard();
    const mockCtxAdmin: any = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { isAdmin: true } }),
      }),
    };
    expect(guard.canActivate(mockCtxAdmin)).toBe(true);
  });

  it('defaultCacheConfigOptions defines TTL values', () => {
    expect(defaultCacheConfigOptions.ttlFeed).toBe(30);
    expect(defaultCacheConfigOptions.ttlProfile).toBe(300);
  });
});
