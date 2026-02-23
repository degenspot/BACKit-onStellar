import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IpRule, IpRuleType } from './entities/ip-rule.entity';
import { BlockedRequest, BlockReason } from './entities/blocked-request.entity';
import { ipMatchesCidr, isBotUserAgent, generateFirewallErrorCode } from './utils/ip-matcher.util';

export interface FirewallVerdict {
  allowed: boolean;
  reason?: BlockReason;
  errorCode?: string;
}

interface RequestSnapshot {
  ip: string;
  method: string;
  path: string;
  userAgent: string | undefined;
  headers: Record<string, string>;
}

@Injectable()
export class FirewallService implements OnModuleInit {
  private readonly logger = new Logger(FirewallService.name);

  /** In-memory rule cache — refreshed every CACHE_TTL_MS milliseconds. */
  private ruleCache: IpRule[] = [];
  private cacheLoadedAt = 0;
  private readonly CACHE_TTL_MS = 60_000; // 1 minute

  constructor(
    @InjectRepository(IpRule)
    private readonly ruleRepo: Repository<IpRule>,

    @InjectRepository(BlockedRequest)
    private readonly blockedRepo: Repository<BlockedRequest>,
  ) {}

  async onModuleInit() {
    await this.refreshCache();
    this.logger.log(`Firewall initialised — ${this.ruleCache.length} IP rules loaded`);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Main evaluation function called by the middleware.
   * Returns { allowed: true } or { allowed: false, reason, errorCode }.
   */
  async evaluate(snapshot: RequestSnapshot): Promise<FirewallVerdict> {
    await this.maybeRefreshCache();

    const { ip, userAgent } = snapshot;

    // 1. Whitelist check — always allow if explicitly whitelisted
    const whitelisted = this.ruleCache
      .filter((r) => r.type === IpRuleType.WHITELIST)
      .some((r) => ipMatchesCidr(ip, r.cidr));

    if (whitelisted) return { allowed: true };

    // 2. Blacklist check
    const blacklisted = this.ruleCache
      .filter((r) => r.type === IpRuleType.BLACKLIST)
      .some((r) => ipMatchesCidr(ip, r.cidr));

    if (blacklisted) {
      return this.block(snapshot, BlockReason.BLACKLISTED_IP);
    }

    // 3. Bot UA fingerprint check
    if (isBotUserAgent(userAgent)) {
      return this.block(snapshot, BlockReason.BOT_FINGERPRINT);
    }

    return { allowed: true };
  }

  /**
   * Called from the Turnstile guard after a failed challenge verification.
   * Writes a TURNSTILE_FAILED blocked-request record.
   */
  async recordTurnstileFailure(snapshot: RequestSnapshot): Promise<FirewallVerdict> {
    return this.block(snapshot, BlockReason.TURNSTILE_FAILED);
  }

  // ─── IP Rule CRUD (used by the admin controller) ──────────────────────────

  async getRules(): Promise<IpRule[]> {
    return this.ruleRepo.find({ order: { createdAt: 'DESC' } });
  }

  async addRule(
    cidr: string,
    type: IpRuleType,
    reason: string | null,
    createdBy: string | null,
  ): Promise<IpRule> {
    const rule = this.ruleRepo.create({ cidr, type, reason, createdBy });
    const saved = await this.ruleRepo.save(rule);
    await this.refreshCache(); // immediate cache bust
    this.logger.log(`Firewall rule added: [${type}] ${cidr} by ${createdBy ?? 'system'}`);
    return saved;
  }

  async removeRule(id: string): Promise<void> {
    await this.ruleRepo.delete(id);
    await this.refreshCache();
    this.logger.log(`Firewall rule removed: ${id}`);
  }

  // ─── Blocked-request log queries ──────────────────────────────────────────

  async getBlockedRequests(
    page = 1,
    limit = 50,
    ip?: string,
    reason?: BlockReason,
  ): Promise<{ data: BlockedRequest[]; total: number }> {
    const qb = this.blockedRepo
      .createQueryBuilder('br')
      .orderBy('br.blockedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (ip) qb.andWhere('br.ip = :ip', { ip });
    if (reason) qb.andWhere('br.reason = :reason', { reason });

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async block(
    snapshot: RequestSnapshot,
    reason: BlockReason,
  ): Promise<FirewallVerdict> {
    const errorCode = generateFirewallErrorCode();

    // Persist asynchronously — do not await in the hot path
    this.persistBlockedRequest(snapshot, reason, errorCode).catch((err) =>
      this.logger.error('Failed to persist blocked-request log', (err as Error).stack),
    );

    this.logger.warn(
      `🚫 Blocked [${reason}] ip=${snapshot.ip} path=${snapshot.method} ${snapshot.path} code=${errorCode}`,
    );

    return { allowed: false, reason, errorCode };
  }

  private async persistBlockedRequest(
    snapshot: RequestSnapshot,
    reason: BlockReason,
    errorCode: string,
  ): Promise<void> {
    const SAFE_HEADERS: (keyof RequestSnapshot['headers'])[] = [
      'accept',
      'accept-language',
      'content-type',
      'origin',
      'referer',
      'x-forwarded-for',
      'cf-ipcountry',
    ];

    const safeHeaders: Record<string, string> = {};
    for (const key of SAFE_HEADERS) {
      if (snapshot.headers[key]) safeHeaders[key] = snapshot.headers[key];
    }

    const entry = this.blockedRepo.create({
      errorCode,
      ip: snapshot.ip,
      reason,
      method: snapshot.method,
      path: snapshot.path,
      userAgent: snapshot.userAgent ?? null,
      headers: safeHeaders,
    });

    await this.blockedRepo.save(entry);
  }

  private async maybeRefreshCache(): Promise<void> {
    if (Date.now() - this.cacheLoadedAt > this.CACHE_TTL_MS) {
      await this.refreshCache();
    }
  }

  private async refreshCache(): Promise<void> {
    this.ruleCache = await this.ruleRepo.find();
    this.cacheLoadedAt = Date.now();
  }
}