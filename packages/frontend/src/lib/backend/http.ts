/**
 * Thin, typed HTTP boundary for the NestJS backend.
 *
 * Every market/portfolio request goes through `apiFetch` so the UI can tell
 * apart the three failure modes it has to render differently:
 *   - `ApiError` with a status  → the backend answered, but rejected us
 *   - `NotFoundError`           → the resource does not exist (empty state)
 *   - `BackendUnavailableError` → no answer at all (network/timeout/5xx)
 */

/** Base URL of the NestJS API. Same env var the rest of the app already uses. */
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

const DEFAULT_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Not found") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

/**
 * The backend could not be reached (offline, DNS, timeout) or replied 5xx.
 * Screens must surface this instead of falling back to placeholder data.
 */
export class BackendUnavailableError extends Error {
  constructor(
    message = "Backend is unavailable",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BackendUnavailableError";
  }
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** JSON-serialisable request body. */
  body?: unknown;
  /** Query string parameters; `undefined` values are dropped. */
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

function buildUrl(
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const url = `${BACKEND_URL.replace(/\/$/, "")}${path}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body;
  if (body && typeof body === "object") {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message) && typeof message[0] === "string") {
      return message.join(", ");
    }
  }
  return fallback;
}

/**
 * Perform a JSON request against the backend.
 *
 * @throws {NotFoundError} on 404
 * @throws {ApiError} on any other 4xx
 * @throws {BackendUnavailableError} on 5xx, timeout or network failure
 */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const {
    method = "GET",
    body,
    query,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    headers = {},
  } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    // A caller-initiated abort is not a backend problem — re-throw as-is.
    if (signal?.aborted) throw err;
    throw new BackendUnavailableError(
      `Could not reach the BACKit API at ${BACKEND_URL}`,
      err,
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }

  if (res.ok) {
    return (await readBody(res)) as T;
  }

  const payload = await readBody(res);

  if (res.status === 404) {
    throw new NotFoundError(errorMessage(payload, "Not found"));
  }
  if (res.status >= 500) {
    throw new BackendUnavailableError(
      errorMessage(payload, `Backend returned ${res.status}`),
    );
  }
  throw new ApiError(
    errorMessage(payload, `Request failed with status ${res.status}`),
    res.status,
    payload,
  );
}

/** Human-readable message for any error thrown by this module. */
export function describeApiError(err: unknown): string {
  if (err instanceof BackendUnavailableError) {
    return "The BACKit API is unavailable. Please retry in a moment.";
  }
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unexpected error";
}
