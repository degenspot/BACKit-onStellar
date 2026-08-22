/**
 * Classification of a dead-lettered job's terminal failure.
 *
 * RETRYABLE_INFRASTRUCTURE - failure caused by a transient external
 *   dependency (Redis hiccup, RPC timeout, upstream 5xx, network error).
 *   Safe to replay once the underlying dependency has recovered.
 * PERMANENT_VALIDATION - the job payload itself is invalid against current
 *   business rules or schema. Replaying without fixing the payload will
 *   fail the same way again.
 * PERMANENT_CONFIGURATION - failure caused by missing/invalid configuration
 *   (bad env var, disabled feature, misconfigured signing key, auth
 *   failure). Needs an operator fix outside the job itself before replay
 *   makes sense.
 * UNKNOWN - classification could not be determined from the error. Treated
 *   conservatively as non-retryable until an operator reviews it.
 */
export enum DeadLetterClassification {
  RETRYABLE_INFRASTRUCTURE = 'RETRYABLE_INFRASTRUCTURE',
  PERMANENT_VALIDATION = 'PERMANENT_VALIDATION',
  PERMANENT_CONFIGURATION = 'PERMANENT_CONFIGURATION',
  UNKNOWN = 'UNKNOWN',
}

const INFRA_PATTERNS: RegExp[] = [
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /EAI_AGAIN/i,
  /ENOTFOUND/i,
  /EPIPE/i,
  /\btimeout\b/i,
  /timed out/i,
  /socket hang up/i,
  /connection (?:reset|refused|closed)/i,
  /\b5\d{2}\b/, // HTTP 5xx
  /rate limit/i,
  /too many requests/i,
  /\b429\b/,
];

const CONFIG_PATTERNS: RegExp[] = [
  /missing.*(?:env|config|api[\s-]?key|credential)/i,
  /invalid.*(?:api[\s-]?key|credential|config)/i,
  /not configured/i,
  /unauthorized/i,
  /forbidden/i,
  /\b401\b/,
  /\b403\b/,
];

/**
 * Heuristically classify a terminal job failure from its error.
 *
 * Intentionally conservative: only errors matching a recognized infra or
 * config pattern are classified as such. Everything else falls through to
 * PERMANENT_VALIDATION rather than RETRYABLE_INFRASTRUCTURE, since the
 * classification drives whether an operator is nudged toward "just replay
 * it" - a false positive there causes a doomed replay loop, which is worse
 * than an operator having to manually confirm an ambiguous case.
 */
export function classifyFailure(
  err: { name?: string; message?: string } | undefined,
): DeadLetterClassification {
  if (!err || (!err.name && !err.message)) {
    return DeadLetterClassification.UNKNOWN;
  }

  const text = `${err.name ?? ''} ${err.message ?? ''}`;

  if (CONFIG_PATTERNS.some((pattern) => pattern.test(text))) {
    return DeadLetterClassification.PERMANENT_CONFIGURATION;
  }
  if (INFRA_PATTERNS.some((pattern) => pattern.test(text))) {
    return DeadLetterClassification.RETRYABLE_INFRASTRUCTURE;
  }
  return DeadLetterClassification.PERMANENT_VALIDATION;
}
