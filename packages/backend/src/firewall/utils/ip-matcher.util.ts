/**
 * ip-matcher.util.ts
 *
 * Pure functions for matching IPv4/IPv6 addresses against CIDR ranges.
 * Uses the built-in `net` module — zero external dependencies needed for
 * basic IPv4 CIDR. For production-grade IPv6 CIDR support, install `ip-range-check`.
 */

import * as net from 'net';

/**
 * Returns true if `ip` falls within the `cidr` block.
 *
 * Handles:
 *  - Plain addresses with no mask  → treated as /32 (IPv4) or /128 (IPv6)
 *  - Standard CIDR notation        → "10.0.0.0/8", "2001:db8::/32"
 *
 * @param ip    The incoming request IP (may include ::ffff: IPv4-mapped prefix)
 * @param cidr  A CIDR string or plain IP stored in the ip_rules table
 */
export function ipMatchesCidr(ip: string, cidr: string): boolean {
  try {
    // Strip IPv4-mapped IPv6 prefix (::ffff:1.2.3.4 → 1.2.3.4)
    const cleanIp = ip.replace(/^::ffff:/i, '');

    // Plain IP — no CIDR mask, do exact match
    if (!cidr.includes('/')) {
      return net.isIP(cleanIp) !== 0 && cleanIp === cidr;
    }

    const [range, bitsStr] = cidr.split('/');
    const bits = parseInt(bitsStr, 10);

    // IPv4 CIDR
    if (net.isIPv4(cleanIp) && net.isIPv4(range)) {
      return ipv4InCidr(cleanIp, range, bits);
    }

    // IPv6 CIDR (basic prefix comparison)
    if (net.isIPv6(cleanIp) && net.isIPv6(range)) {
      return ipv6InCidr(cleanIp, range, bits);
    }

    return false;
  } catch {
    return false;
  }
}

// ─── IPv4 helpers ──────────────────────────────────────────────────────────

function ipToUint32(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function ipv4InCidr(ip: string, range: string, bits: number): boolean {
  if (bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipToUint32(ip) & mask) === (ipToUint32(range) & mask);
}

// ─── IPv6 helpers (prefix comparison) ─────────────────────────────────────

function ipv6ToBigInt(ip: string): bigint {
  // expand :: shorthand
  const full = expandIPv6(ip);
  return full
    .split(':')
    .reduce((acc, group) => (acc << 16n) + BigInt(parseInt(group, 16)), 0n);
}

function expandIPv6(ip: string): string {
  const halves = ip.split('::');
  if (halves.length === 2) {
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    const middle = Array(missing).fill('0');
    return [...left, ...middle, ...right].map((g) => g.padStart(4, '0')).join(':');
  }
  return ip
    .split(':')
    .map((g) => g.padStart(4, '0'))
    .join(':');
}

function ipv6InCidr(ip: string, range: string, bits: number): boolean {
  if (bits < 0 || bits > 128) return false;
  const mask = bits === 0 ? 0n : (~0n << BigInt(128 - bits)) & ((1n << 128n) - 1n);
  return (ipv6ToBigInt(ip) & mask) === (ipv6ToBigInt(range) & mask);
}

// ─── Error code generator ──────────────────────────────────────────────────

/**
 * Generates a unique, human-readable firewall error code.
 * Format: BACKIT-FW-<YYYYMMDD>-<6-char hex>
 * Example: BACKIT-FW-20240315-a3f9c1
 */
export function generateFirewallErrorCode(): string {
  const date = new Date();
  const datePart = date.toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  return `BACKIT-FW-${datePart}-${randomPart}`;
}

/** Known bot / scraper User-Agent substrings. Case-insensitive matching. */
export const BOT_UA_PATTERNS: RegExp[] = [
  /bot/i,
  /crawl/i,
  /spider/i,
  /scrape/i,
  /curl\//i,
  /wget\//i,
  /python-requests/i,
  /go-http-client/i,
  /axios\//i,        // headless scripts often forget to change UA
  /java\//i,
  /libwww-perl/i,
  /scrapy/i,
  /semrush/i,
  /ahrefs/i,
  /mj12bot/i,
  /dotbot/i,
  /sistrix/i,
  /petalbot/i,
];

/**
 * Returns true if the User-Agent string matches a known bot pattern.
 * Pass `allowedBots` (e.g. Googlebot) to exclude legitimate crawlers.
 */
export function isBotUserAgent(
  userAgent: string | undefined,
  allowedBots: RegExp[] = [],
): boolean {
  if (!userAgent) return true; // missing UA is suspicious
  if (allowedBots.some((r) => r.test(userAgent))) return false;
  return BOT_UA_PATTERNS.some((r) => r.test(userAgent));
}

/** Extract the real client IP, respecting common reverse-proxy headers. */
export function extractClientIp(req: {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string {
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp) return Array.isArray(cfIp) ? cfIp[0] : cfIp;

  const xReal = req.headers['x-real-ip'];
  if (xReal) return Array.isArray(xReal) ? xReal[0] : xReal;

  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return first.split(',')[0].trim();
  }

  return req.ip ?? req.socket?.remoteAddress ?? '0.0.0.0';
}