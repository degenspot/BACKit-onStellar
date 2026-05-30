import { UseGuards, applyDecorators } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MutationThrottlerGuard } from '../guards/mutation-throttler.guard';
import {
  THROTTLER_MUTATION_NAME,
  THROTTLER_MUTATION_TTL,
  THROTTLER_MUTATION_LIMIT,
} from '../throttler.constants';

export function ThrottleMutation() {
  return applyDecorators(
    Throttle({
      [THROTTLER_MUTATION_NAME]: {
        ttl: THROTTLER_MUTATION_TTL,
        limit: THROTTLER_MUTATION_LIMIT,
      },
    }),
    UseGuards(MutationThrottlerGuard),
  );
}
