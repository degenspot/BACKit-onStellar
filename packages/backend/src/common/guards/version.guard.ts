/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  GoneException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const DEPRECATED_VERSION_KEY = 'deprecatedVersion';
export const SUNSET_DATE_KEY = 'sunsetDate';

export function Deprecated(
  sunsetDate?: string,
): MethodDecorator & ClassDecorator {
  return (target: any, key?: string | symbol, descriptor?: any) => {
    const metaTarget = descriptor ? descriptor.value : target;
    Reflect.defineMetadata(DEPRECATED_VERSION_KEY, true, metaTarget);
    if (sunsetDate)
      Reflect.defineMetadata(SUNSET_DATE_KEY, sunsetDate, metaTarget);
    return descriptor ?? target;
  };
}

@Injectable()
export class VersionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const isDeprecated = Reflect.getMetadata(DEPRECATED_VERSION_KEY, handler);

    if (!isDeprecated) return true;

    const sunsetDate = Reflect.getMetadata(SUNSET_DATE_KEY, handler) as
      | string
      | undefined;
    if (sunsetDate && new Date() > new Date(sunsetDate)) {
      throw new GoneException(
        `This API version was sunset on ${sunsetDate}. Please upgrade to /api/v1/.`,
      );
    }

    const response = context.switchToHttp().getResponse();
    response.setHeader('Deprecation', 'true');
    if (sunsetDate) response.setHeader('Sunset', sunsetDate);

    return true;
  }
}
