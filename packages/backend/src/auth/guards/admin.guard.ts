import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // TODO: Implement real admin check logic here.
    // For now, we assume all authenticated users are admins for development,
    // or check if they have an 'isAdmin' flag / 'admin' role.
    return !!user;
  }
}
