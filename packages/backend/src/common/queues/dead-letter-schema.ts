import {
  QUEUE_IPFS_PINNING,
  QUEUE_NOTIFICATIONS,
  QUEUE_ORACLE_SIGNING,
  QueueName,
} from './queues.constants';

/**
 * Validates a source job's *original* (unredacted) data against the shape
 * that queue's processor currently expects, immediately before replay.
 *
 * This is deliberately separate from dead-letter-redaction.ts: redaction
 * decides what's safe to *show* an operator; this decides what's safe to
 * *re-enqueue*. A job that failed months ago may no longer match the
 * queue's current schema (a field renamed, a new required field added) -
 * replaying it as-is would either crash the processor or silently do the
 * wrong thing, so replay must re-validate against today's shape, not just
 * trust that "it was a valid job once."
 */
export type SchemaValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateOracleSigningJobData(data: unknown): SchemaValidationResult {
  if (!isPlainObject(data))
    return { valid: false, reason: 'data is not an object' };
  if (!isPlainObject(data.payload)) {
    return { valid: false, reason: 'data.payload is missing or not an object' };
  }
  const { asset, price, timestamp } = data.payload;
  if (typeof asset !== 'string' || asset.length === 0) {
    return { valid: false, reason: 'payload.asset must be a non-empty string' };
  }
  if (
    typeof price !== 'string' ||
    price.length === 0 ||
    Number.isNaN(Number(price))
  ) {
    return { valid: false, reason: 'payload.price must be a numeric string' };
  }
  if (
    typeof timestamp !== 'number' ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0
  ) {
    return {
      valid: false,
      reason: 'payload.timestamp must be a positive number',
    };
  }
  return { valid: true };
}

function validateIpfsPinningJobData(data: unknown): SchemaValidationResult {
  if (!isPlainObject(data))
    return { valid: false, reason: 'data is not an object' };
  if (data.type === 'call-content') {
    const content = data.content;
    if (!isPlainObject(content)) {
      return { valid: false, reason: 'content is missing or not an object' };
    }
    if (typeof content.title !== 'string' || content.title.length === 0) {
      return {
        valid: false,
        reason: 'content.title must be a non-empty string',
      };
    }
    if (typeof content.thesis !== 'string' || content.thesis.length === 0) {
      return {
        valid: false,
        reason: 'content.thesis must be a non-empty string',
      };
    }
    if (
      typeof content.createdAt !== 'string' ||
      content.createdAt.length === 0
    ) {
      return {
        valid: false,
        reason: 'content.createdAt must be a non-empty string',
      };
    }
    return { valid: true };
  }
  if (data.type === 'oracle-evidence') {
    const evidence = data.evidence;
    if (!isPlainObject(evidence)) {
      return { valid: false, reason: 'evidence is missing or not an object' };
    }
    if (
      typeof evidence.callId !== 'number' ||
      !Number.isFinite(evidence.callId)
    ) {
      return { valid: false, reason: 'evidence.callId must be a number' };
    }
    if (
      typeof evidence.timestamp !== 'string' ||
      evidence.timestamp.length === 0
    ) {
      return {
        valid: false,
        reason: 'evidence.timestamp must be a non-empty string',
      };
    }
    if (typeof evidence.source !== 'string' || evidence.source.length === 0) {
      return {
        valid: false,
        reason: 'evidence.source must be a non-empty string',
      };
    }
    return { valid: true };
  }
  return {
    valid: false,
    reason: `unrecognized ipfs-pinning job type "${String(data.type)}"`,
  };
}

function validateNotificationsJobData(data: unknown): SchemaValidationResult {
  if (!isPlainObject(data))
    return { valid: false, reason: 'data is not an object' };
  if (
    typeof data.notificationId !== 'number' ||
    !Number.isFinite(data.notificationId)
  ) {
    return { valid: false, reason: 'notificationId must be a number' };
  }
  return { valid: true };
}

/**
 * Validate a source job's data against its queue's current schema.
 * Returns `{ valid: false }` (never throws) for both malformed data and an
 * unrecognized/unsupported source queue - both cases should be treated by
 * the caller as "reject this replay", not as a crash.
 */
export function validateSourceJobData(
  sourceQueue: QueueName,
  data: unknown,
): SchemaValidationResult {
  switch (sourceQueue) {
    case QUEUE_ORACLE_SIGNING:
      return validateOracleSigningJobData(data);
    case QUEUE_IPFS_PINNING:
      return validateIpfsPinningJobData(data);
    case QUEUE_NOTIFICATIONS:
      return validateNotificationsJobData(data);
    default:
      return {
        valid: false,
        reason: `replay is not supported for source queue "${sourceQueue}"`,
      };
  }
}
