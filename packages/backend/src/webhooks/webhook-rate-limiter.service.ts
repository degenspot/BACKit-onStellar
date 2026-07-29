import { Injectable, Logger } from '@nestjs/common';

interface RateLimitEntry {
  timestamps: number[];
}

@Injectable()
export class WebhookRateLimiterService {
  private readonly logger = new Logger(WebhookRateLimiterService.name);
  private readonly store = new Map<string, RateLimitEntry>();

  /** Max requests per second per webhook URL */
  private readonly MAX_REQUESTS = 10;
  private readonly WINDOW_MS = 1000;

  /**
   * Check if a request to the given URL is allowed under the rate limit.
   * Returns true if allowed, false if rate-limited.
   */
  isAllowed(url: string): boolean {
    const now = Date.now();
    const windowStart = now - this.WINDOW_MS;

    let entry = this.store.get(url);
    if (!entry) {
      entry = { timestamps: [] };
      this.store.set(url, entry);
    }

    // Remove timestamps outside the current window
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    if (entry.timestamps.length >= this.MAX_REQUESTS) {
      this.logger.warn(`Rate limit exceeded for webhook URL: ${url}`);
      return false;
    }

    entry.timestamps.push(now);
    return true;
  }

  /**
   * Clean up stale entries periodically to prevent memory leaks.
   */
  cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.WINDOW_MS * 2;

    for (const [url, entry] of this.store.entries()) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) {
        this.store.delete(url);
      }
    }
  }

  /**
   * Get the store size for monitoring purposes.
   */
  get size(): number {
    return this.store.size;
  }
}
