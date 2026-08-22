import {
  QUEUE_IPFS_PINNING,
  QUEUE_NOTIFICATIONS,
  QUEUE_ORACLE_SIGNING,
  QueueName,
} from './queues.constants';

/**
 * Result of redacting a dead-lettered job's payload.
 *
 * `data` is always a fresh object built field-by-field from an explicit
 * allowlist - nothing outside that allowlist can leak through, including
 * fields added to a job's shape later without this file being updated.
 * `redactionFailed` is true whenever the source payload didn't match the
 * expected shape for its queue closely enough to confidently allowlist it;
 * in that case `data` is a minimal safe stub, never a raw dump.
 */
export type RedactedPayload = {
  data: Record<string, unknown>;
  redactionFailed: boolean;
};

const MAX_TEXT_FIELD_LENGTH = 500;
const MAX_FAILED_REASON_LENGTH = 2000;
const MAX_STACK_FRAMES = 20;
const MAX_STACK_FRAME_LENGTH = 500;

// Patterns for scrubbing secrets that might appear embedded in free-text
// error messages / stack traces (as opposed to structured job data, which
// is handled by the per-queue allowlists below).
const SECRET_TEXT_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /Bearer\s+[A-Za-z0-9._-]{10,}/gi,
  /\b0x[a-fA-F0-9]{32,}\b/g, // hex-encoded keys/signatures
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, // base64-ish long blobs (e.g. seeds, keys)
  /(api[_-]?key|secret|token|password|mnemonic|private[_-]?key)\s*[:=]\s*\S+/gi,
];

function redactSecretText(input: string): string {
  let result = input;
  for (const pattern of SECRET_TEXT_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...[truncated]` : value;
}

/** Sanitizes the free-text failure reason before it is ever persisted. */
export function redactFailedReason(
  failedReason: string | undefined,
): string | undefined {
  if (!failedReason) return failedReason;
  return truncate(redactSecretText(failedReason), MAX_FAILED_REASON_LENGTH);
}

/** Sanitizes and bounds the stack trace before it is ever persisted. */
export function redactStacktrace(
  stacktrace: string[] | undefined,
): string[] | undefined {
  if (!stacktrace) return stacktrace;
  return stacktrace
    .slice(0, MAX_STACK_FRAMES)
    .map((frame) => truncate(redactSecretText(frame), MAX_STACK_FRAME_LENGTH));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

function pickNumber(
  obj: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = obj[key];
  return typeof value === 'number' ? value : undefined;
}

// ---------------------------------------------------------------------------
// oracle-signing: job.data = { payload: { asset, price, timestamp } }
// No secrets live here (the signing key is server config, never job data),
// but the allowlist is still explicit so nothing beyond these three fields
// can ever ride along, now or after a future field is added upstream.
// ---------------------------------------------------------------------------
function redactOracleSigning(data: unknown): RedactedPayload {
  if (!isPlainObject(data) || !isPlainObject(data.payload)) {
    return { data: {}, redactionFailed: true };
  }
  const payload = data.payload;
  const asset = pickString(payload, 'asset');
  const price = pickString(payload, 'price');
  const timestamp = pickNumber(payload, 'timestamp');

  if (asset === undefined || price === undefined || timestamp === undefined) {
    return { data: {}, redactionFailed: true };
  }

  return {
    data: { payload: { asset, price, timestamp } },
    redactionFailed: false,
  };
}

// ---------------------------------------------------------------------------
// ipfs-pinning: job.data is one of two shapes. `conditionJson` and
// `priceData` are untyped (`any`) upstream, so they are dropped entirely
// rather than allowlisted - there's no way to prove they're safe. Free-text
// fields are length-bounded, not dropped, since they're needed for triage.
// ---------------------------------------------------------------------------
function redactIpfsPinning(data: unknown): RedactedPayload {
  if (!isPlainObject(data) || typeof data.type !== 'string') {
    return { data: {}, redactionFailed: true };
  }

  if (data.type === 'call-content') {
    const content = data.content;
    if (!isPlainObject(content)) return { data: {}, redactionFailed: true };
    const title = pickString(content, 'title');
    const thesis = pickString(content, 'thesis');
    const createdAt = pickString(content, 'createdAt');
    if (
      title === undefined ||
      thesis === undefined ||
      createdAt === undefined
    ) {
      return { data: {}, redactionFailed: true };
    }
    return {
      data: {
        type: 'call-content',
        content: {
          title: truncate(title, MAX_TEXT_FIELD_LENGTH),
          thesis: truncate(thesis, MAX_TEXT_FIELD_LENGTH),
          createdAt,
          conditionJsonOmitted: content.conditionJson !== undefined,
        },
      },
      redactionFailed: false,
    };
  }

  if (data.type === 'oracle-evidence') {
    const evidence = data.evidence;
    if (!isPlainObject(evidence)) return { data: {}, redactionFailed: true };
    const callId = pickNumber(evidence, 'callId');
    const timestamp = pickString(evidence, 'timestamp');
    const source = pickString(evidence, 'source');
    if (
      callId === undefined ||
      timestamp === undefined ||
      source === undefined
    ) {
      return { data: {}, redactionFailed: true };
    }
    return {
      data: {
        type: 'oracle-evidence',
        evidence: {
          callId,
          timestamp,
          source,
          priceDataOmitted: evidence.priceData !== undefined,
        },
      },
      redactionFailed: false,
    };
  }

  return { data: {}, redactionFailed: true };
}

// ---------------------------------------------------------------------------
// notifications: job.data = { notificationId }. The job itself only ever
// carries a reference id (the message content/recipient lives in the
// notifications table), so the allowlist is just the id - this also
// guards against a future accidental widening of the job payload (e.g. an
// email address or webhook secret) silently starting to flow into the DLQ.
// ---------------------------------------------------------------------------
function redactNotifications(data: unknown): RedactedPayload {
  if (!isPlainObject(data)) return { data: {}, redactionFailed: true };
  const notificationId = pickNumber(data, 'notificationId');
  if (notificationId === undefined) return { data: {}, redactionFailed: true };
  return { data: { notificationId }, redactionFailed: false };
}

/**
 * Redact/allowlist a dead-lettered job's `data` based on its source queue.
 * Always returns a freshly-built object - never the original reference -
 * so there is no path by which an unlisted field can survive.
 */
export function redactJobData(
  sourceQueue: QueueName,
  data: unknown,
): RedactedPayload {
  switch (sourceQueue) {
    case QUEUE_ORACLE_SIGNING:
      return redactOracleSigning(data);
    case QUEUE_IPFS_PINNING:
      return redactIpfsPinning(data);
    case QUEUE_NOTIFICATIONS:
      return redactNotifications(data);
    default:
      // Any other/future queue routed through the DLQ without an explicit
      // allowlist is treated as a redaction failure, never passed through.
      return { data: {}, redactionFailed: true };
  }
}
