import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LeaderboardModule } from './leaderboard.module';
import {
  PredictionCall,
  LeaderboardSnapshot,
  CallStatus,
  CallOutcome,
} from './leaderboard.entity';

// ── seed helpers ──────────────────────────────────────────────────────────────

async function seedCalls(
  ds: DataSource,
  userId: string,
  calls: Array<{ outcome: CallOutcome; profit: number; settledAt?: Date }>,
) {
  const repo = ds.getRepository(PredictionCall);
  const entities = calls.map((c) =>
    repo.create({
      userId,
      status: CallStatus.SETTLED,
      outcome: c.outcome,
      profitUsdc: c.profit,
      stakeUsdc: 10,
      settledAt: c.settledAt ?? new Date(),
    }),
  );
  return repo.save(entities);
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('Leaderboard (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const USER_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [PredictionCall, LeaderboardSnapshot],
          synchronize: true,
          logging: false,
        }),
        LeaderboardModule,
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();

    dataSource = module.get<DataSource>(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.getRepository(PredictionCall).clear();
  });

  // ── GET /leaderboard ────────────────────────────────────────────────────────

  describe('GET /leaderboard', () => {
    it('returns 200 with empty data when no settled calls', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/leaderboard')
        .expect(200);

      expect(body.data).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('returns sorted leaderboard by profit (default)', async () => {
      await seedCalls(dataSource, USER_A, [
        { outcome: CallOutcome.WON, profit: 100 },
        { outcome: CallOutcome.WON, profit: 50 },
        { outcome: CallOutcome.LOST, profit: -20 },
      ]);
      await seedCalls(dataSource, USER_B, [
        { outcome: CallOutcome.WON, profit: 300 },
        { outcome: CallOutcome.LOST, profit: -10 },
      ]);

      const { body } = await request(app.getHttpServer())
        .get('/leaderboard?sort=profit')
        .expect(200);

      expect(body.data[0].totalProfit).toBeGreaterThan(
        body.data[1].totalProfit,
      );
      expect(body.data[0].rank).toBe(1);
    });

    it('winrate leaderboard excludes users with < 5 settled calls', async () => {
      // USER_A has 4 calls (should be excluded)
      await seedCalls(dataSource, USER_A, [
        { outcome: CallOutcome.WON, profit: 10 },
        { outcome: CallOutcome.WON, profit: 10 },
        { outcome: CallOutcome.WON, profit: 10 },
        { outcome: CallOutcome.WON, profit: 10 },
      ]);

      // USER_B has 5 calls (should be included)
      await seedCalls(dataSource, USER_B, [
        { outcome: CallOutcome.WON, profit: 5 },
        { outcome: CallOutcome.WON, profit: 5 },
        { outcome: CallOutcome.WON, profit: 5 },
        { outcome: CallOutcome.LOST, profit: -5 },
        { outcome: CallOutcome.LOST, profit: -5 },
      ]);

      const { body } = await request(app.getHttpServer())
        .get('/leaderboard?sort=winrate')
        .expect(200);

      const userIds = body.data.map((d: any) => d.userId);
      expect(userIds).not.toContain(USER_A);
      expect(userIds).toContain(USER_B);
    });

    it('timeframe=month filters out old calls', async () => {
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 2);

      // Old call — should be excluded
      await seedCalls(dataSource, USER_A, [
        { outcome: CallOutcome.WON, profit: 999, settledAt: oldDate },
      ]);
      // Recent call
      await seedCalls(dataSource, USER_B, [
        { outcome: CallOutcome.WON, profit: 10 },
      ]);

      const { body } = await request(app.getHttpServer())
        .get('/leaderboard?sort=profit&timeframe=month')
        .expect(200);

      const userIds = body.data.map((d: any) => d.userId);
      expect(userIds).not.toContain(USER_A);
    });

    it('returns 400 for invalid sort value', async () => {
      await request(app.getHttpServer())
        .get('/leaderboard?sort=invalid')
        .expect(400);
    });

    it('returns 400 for invalid timeframe value', async () => {
      await request(app.getHttpServer())
        .get('/leaderboard?timeframe=week')
        .expect(400);
    });

    it('paginates results correctly', async () => {
      // Seed 3 users
      for (let i = 0; i < 3; i++) {
        const uid = `${i}${USER_A.slice(1)}`;
        await seedCalls(dataSource, uid, [
          { outcome: CallOutcome.WON, profit: (i + 1) * 10 },
          { outcome: CallOutcome.LOST, profit: -1 },
        ]);
      }

      const { body } = await request(app.getHttpServer())
        .get('/leaderboard?page=1&limit=2')
        .expect(200);

      expect(body.data).toHaveLength(2);
      expect(body.pages).toBe(2);
    });

    it('response includes meta fields', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/leaderboard')
        .expect(200);

      expect(body).toMatchObject({
        data: expect.any(Array),
        total: expect.any(Number),
        page: expect.any(Number),
        limit: expect.any(Number),
        pages: expect.any(Number),
        sort: expect.any(String),
        timeframe: expect.any(String),
        generatedAt: expect.any(String),
      });
    });
  });

  // ── GET /leaderboard/users/:userId ──────────────────────────────────────────

  describe('GET /leaderboard/users/:userId', () => {
    it('returns 400 for non-UUID userId', async () => {
      await request(app.getHttpServer())
        .get('/leaderboard/users/not-a-uuid')
        .expect(400);
    });

    it('returns stats with zeros for user with no calls', async () => {
      const { body } = await request(app.getHttpServer())
        .get(`/leaderboard/users/${USER_A}`)
        .expect(200);

      expect(body).toMatchObject({
        userId: USER_A,
        rank: null,
        totalCalls: 0,
        wonCalls: 0,
        lostCalls: 0,
        winRate: 0,
        totalProfit: 0,
        qualifiesForWinRate: false,
      });
    });

    it('returns correct win rate and profit for user with settled calls', async () => {
      await seedCalls(dataSource, USER_A, [
        { outcome: CallOutcome.WON, profit: 100 },
        { outcome: CallOutcome.WON, profit: 50 },
        { outcome: CallOutcome.LOST, profit: -30 },
        { outcome: CallOutcome.WON, profit: 20 },
        { outcome: CallOutcome.LOST, profit: -10 },
      ]);

      const { body } = await request(app.getHttpServer())
        .get(`/leaderboard/users/${USER_A}`)
        .expect(200);

      expect(body.totalCalls).toBe(5);
      expect(body.wonCalls).toBe(3);
      expect(body.lostCalls).toBe(2);
      expect(body.winRate).toBeCloseTo(60, 0);
      expect(body.totalProfit).toBeCloseTo(130, 0);
      expect(body.qualifiesForWinRate).toBe(true);
    });

    it('does not count pending calls toward stats', async () => {
      const repo = dataSource.getRepository(PredictionCall);
      await repo.save(
        repo.create({
          userId: USER_A,
          status: CallStatus.PENDING,
          outcome: null,
          profitUsdc: 0,
          stakeUsdc: 10,
        }),
      );

      const { body } = await request(app.getHttpServer())
        .get(`/leaderboard/users/${USER_A}`)
        .expect(200);

      expect(body.totalCalls).toBe(0);
    });
  });
});
