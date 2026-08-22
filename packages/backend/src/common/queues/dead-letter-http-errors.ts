import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Translates a DeadLetterService rejection reason string into an
 * appropriate HTTP exception. The service itself never throws for
 * expected rejections (not found / already terminal / schema mismatch /
 * lock contention) - it returns a typed `{ outcome: 'rejected', reason }`
 * so callers (tests, future non-HTTP callers) don't have to deal with
 * exceptions for expected outcomes. This is the one place that maps those
 * reasons to a status code for the HTTP layer.
 */
export function rejectionToHttpException(reason: string): Error {
  if (reason.includes('not found')) {
    return new NotFoundException(reason);
  }
  if (
    reason.includes('schema validation') ||
    reason.includes('not supported')
  ) {
    return new UnprocessableEntityException(reason);
  }
  // Everything else (already terminal, source job missing/not in a
  // replayable state, lock contention) reflects the entry's current state
  // conflicting with the requested action - 409 is the right status for
  // all of these.
  return new ConflictException(reason);
}
