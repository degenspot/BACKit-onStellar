import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Badge, BadgeType } from './entities/badge.entity';
import { Users } from './entities/users.entity';

// ── Thresholds — tweak without touching logic ──────────────────────────────
const EARLY_ADOPTER_DAYS   = 30;    // days from platform launch to qualify
const WHALE_STAKE_THRESHOLD = 1000; // total XLM staked across all calls
const HIGH_ACCURACY_MIN_CALLS = 10; // minimum resolved calls to qualify
const HIGH_ACCURACY_WIN_RATE  = 0.7; // 70% win rate required

// Platform launch date — used to determine early adopter eligibility
const PLATFORM_LAUNCH = new Date('2024-01-01T00:00:00.000Z');

@Injectable()
export class BadgeWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(BadgeWorker.name);

  constructor(
    @InjectRepository(Badge)
    private readonly badgeRepo: Repository<Badge>,
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,
    private readonly dataSource: DataSource,
  ) {}

  // Seed badge definitions on boot so they always exist
  async onApplicationBootstrap() {
    await this.seedBadgeDefinitions();
  }

  // ── Cron: run every night at 02:00 UTC ────────────────────────────────────
  @Cron('0 2 * * *')
  async runBadgeAssignment() {
    this.logger.log('Badge assignment cron started');
    await Promise.all([
      this.assignEarlyAdopterBadge(),
      this.assignWhaleBadge(),
      this.assignHighAccuracyBadge(),
    ]);
    this.logger.log('Badge assignment cron complete');
  }

  // ── Seed ──────────────────────────────────────────────────────────────────

  private async seedBadgeDefinitions() {
    const definitions: Pick<Badge, 'type' | 'name' | 'description'>[] = [
      {
        type: BadgeType.EARLY_ADOPTER,
        name: 'Early Adopter',
        description: `Joined within the first ${EARLY_ADOPTER_DAYS} days of the platform.`,
      },
      {
        type: BadgeType.WHALE,
        name: 'Whale',
        description: `Staked more than ${WHALE_STAKE_THRESHOLD} XLM in total across all calls.`,
      },
      {
        type: BadgeType.HIGH_ACCURACY,
        name: 'High Accuracy',
        description: `Achieved a ${HIGH_ACCURACY_WIN_RATE * 100}% win rate across at least ${HIGH_ACCURACY_MIN_CALLS} resolved calls.`,
      },
    ];

    for (const def of definitions) {
      const exists = await this.badgeRepo.findOne({ where: { type: def.type } });
      if (!exists) {
        await this.badgeRepo.save(this.badgeRepo.create(def));
        this.logger.log(`Seeded badge: ${def.type}`);
      }
    }
  }

  // ── Early Adopter ─────────────────────────────────────────────────────────

  private async assignEarlyAdopterBadge() {
    const badge = await this.badgeRepo.findOne({
      where: { type: BadgeType.EARLY_ADOPTER },
    });
    if (!badge) return;

    const cutoff = new Date(
      PLATFORM_LAUNCH.getTime() + EARLY_ADOPTER_DAYS * 24 * 60 * 60 * 1000,
    );

    // Find qualifying users who don't already hold this badge — idempotent
    const qualifying: { id: string }[] = await this.dataSource.query(
      `
      SELECT u.id
      FROM users u
      WHERE u."createdAt" <= $1
        AND NOT EXISTS (
          SELECT 1 FROM user_badges ub
          WHERE ub."userId" = u.id AND ub."badgeId" = $2
        )
      `,
      [cutoff, badge.id],
    );

    await this.bulkAssign(qualifying.map((r) => r.id), badge);
    this.logger.log(`Early Adopter: assigned to ${qualifying.length} new users`);
  }

  // ── Whale ─────────────────────────────────────────────────────────────────

  private async assignWhaleBadge() {
    const badge = await this.badgeRepo.findOne({
      where: { type: BadgeType.WHALE },
    });
    if (!badge) return;

    // Sum stakeAmount per creator across all calls
    const qualifying: { id: string }[] = await this.dataSource.query(
      `
      SELECT u.id
      FROM users u
      INNER JOIN calls c ON c."creatorAddress" = u."walletAddress"
      WHERE NOT EXISTS (
        SELECT 1 FROM user_badges ub
        WHERE ub."userId" = u.id AND ub."badgeId" = $2
      )
      GROUP BY u.id
      HAVING SUM(CAST(c."stakeAmount" AS numeric)) >= $1
      `,
      [WHALE_STAKE_THRESHOLD, badge.id],
    );

    await this.bulkAssign(qualifying.map((r) => r.id), badge);
    this.logger.log(`Whale: assigned to ${qualifying.length} new users`);
  }

  // ── High Accuracy ─────────────────────────────────────────────────────────

  private async assignHighAccuracyBadge() {
    const badge = await this.badgeRepo.findOne({
      where: { type: BadgeType.HIGH_ACCURACY },
    });
    if (!badge) return;

    // Win = call resolved in the direction the creator predicted
    // Requires calls table to have status RESOLVED_YES / RESOLVED_NO
    const qualifying: { id: string }[] = await this.dataSource.query(
      `
      SELECT u.id
      FROM users u
      INNER JOIN calls c ON c."creatorAddress" = u."walletAddress"
      WHERE c.status IN ('RESOLVED_YES', 'RESOLVED_NO')
        AND NOT EXISTS (
          SELECT 1 FROM user_badges ub
          WHERE ub."userId" = u.id AND ub."badgeId" = $3
        )
      GROUP BY u.id
      HAVING
        COUNT(*) >= $1
        AND (
          SUM(CASE WHEN c.status = 'RESOLVED_YES' THEN 1 ELSE 0 END)::float
          / NULLIF(COUNT(*), 0)
        ) >= $2
      `,
      [HIGH_ACCURACY_MIN_CALLS, HIGH_ACCURACY_WIN_RATE, badge.id],
    );

    await this.bulkAssign(qualifying.map((r) => r.id), badge);
    this.logger.log(`High Accuracy: assigned to ${qualifying.length} new users`);
  }

  // ── Shared bulk-assign (idempotent via NOT EXISTS guard in queries) ────────

  private async bulkAssign(userIds: string[], badge: Badge) {
    if (userIds.length === 0) return;

    // Load users with their current badges to safely push without duplicates
    const users = await this.usersRepo.find({
      where: userIds.map((id) => ({ id })),
      relations: ['badges'],
    });

    for (const user of users) {
      const alreadyHas = user.badges.some((b) => b.id === badge.id);
      if (!alreadyHas) {
        user.badges.push(badge);
        await this.usersRepo.save(user);
      }
    }
  }
}