import {
  ForbiddenException,
  UnauthorizedException,
  ExecutionContext,
} from '@nestjs/common';
import { AdminGuard } from './admin.guard';

function makeContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  it('rejects unauthenticated requests', () => {
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects authenticated non-admin users', () => {
    expect(() =>
      guard.canActivate(
        makeContext({ id: 'user-1', isAdmin: false, role: 'user' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows users with isAdmin=true', () => {
    expect(
      guard.canActivate(makeContext({ id: 'user-1', isAdmin: true })),
    ).toBe(true);
  });

  it('allows users with role="admin"', () => {
    expect(
      guard.canActivate(makeContext({ id: 'user-1', role: 'admin' })),
    ).toBe(true);
  });
});
