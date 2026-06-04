import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateCallDto } from '../../calls/dto/create-call.dto';
import { QueryCallsDto } from '../../calls/dto/query-calls.dto';
import { AnalyticsQueryDto } from '../../analytics/dto/analytics-query.dto';
import { FollowDto } from '../../user/dto/follow.dto';
import { GetNotificationsDto } from '../../notifications/dto/get-notifications.dto';

async function errors(cls: any, plain: object) {
  return validate(plainToInstance(cls, plain));
}

const VALID_STELLAR = 'GBZNLMUQMIN3VGUJISCHKMMTNMDSYFZLHFB5BKRH2HZ7ZBYXUQYXQZWX';

// ─── 1. CreateCallDto ─────────────────────────────────────────────────────────
describe('CreateCallDto validation (endpoint: POST /calls)', () => {
  const base = {
    title: 'Valid title',
    thesis: 'Analysis',
    tokenAddress: 'CABC',
    pairId: 'pair1',
    stakeToken: 'XLM',
    stakeAmount: 10,
    endTs: new Date().toISOString(),
    creatorAddress: VALID_STELLAR,
  };

  it('rejects missing title', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { title: _, ...rest } = base;
    expect((await errors(CreateCallDto, rest)).some(e => e.property === 'title')).toBe(true);
  });

  it('rejects title longer than 200 chars', async () => {
    const errs = await errors(CreateCallDto, { ...base, title: 'a'.repeat(201) });
    expect(errs.some(e => e.property === 'title')).toBe(true);
  });

  it('rejects invalid Stellar creatorAddress', async () => {
    const errs = await errors(CreateCallDto, { ...base, creatorAddress: 'not-stellar' });
    expect(errs.some(e => e.property === 'creatorAddress')).toBe(true);
  });

  it('rejects negative stakeAmount', async () => {
    const errs = await errors(CreateCallDto, { ...base, stakeAmount: -5 });
    expect(errs.some(e => e.property === 'stakeAmount')).toBe(true);
  });

  it('accepts a fully valid payload', async () => {
    expect(await errors(CreateCallDto, base)).toHaveLength(0);
  });
});

// ─── 2. QueryCallsDto ────────────────────────────────────────────────────────
describe('QueryCallsDto validation (endpoint: GET /calls/feed, GET /calls/search)', () => {
  it('accepts empty payload (all optional)', async () => {
    expect(await errors(QueryCallsDto, {})).toHaveLength(0);
  });

  it('rejects invalid sort value', async () => {
    const errs = await errors(QueryCallsDto, { sort: 'oldest' });
    expect(errs.some(e => e.property === 'sort')).toBe(true);
  });

  it('rejects page below 1', async () => {
    const errs = await errors(QueryCallsDto, { page: 0 });
    expect(errs.some(e => e.property === 'page')).toBe(true);
  });

  it('rejects limit above 100', async () => {
    const errs = await errors(QueryCallsDto, { limit: 101 });
    expect(errs.some(e => e.property === 'limit')).toBe(true);
  });

  it('accepts valid sort=trending with pagination', async () => {
    expect(await errors(QueryCallsDto, { sort: 'trending', page: 2, limit: 50 })).toHaveLength(0);
  });
});

// ─── 3. AnalyticsQueryDto ────────────────────────────────────────────────────
describe('AnalyticsQueryDto validation (endpoint: GET /users/:address/analytics)', () => {
  it('rejects an unknown range value', async () => {
    const errs = await errors(AnalyticsQueryDto, { range: 'weekly' });
    expect(errs.some(e => e.property === 'range')).toBe(true);
  });

  it('accepts range=7d', async () => {
    expect(await errors(AnalyticsQueryDto, { range: '7d' })).toHaveLength(0);
  });

  it('accepts range=30d', async () => {
    expect(await errors(AnalyticsQueryDto, { range: '30d' })).toHaveLength(0);
  });
});

// ─── 4. FollowDto ────────────────────────────────────────────────────────────
describe('FollowDto validation (endpoint: POST /users/:address/follow)', () => {
  it('rejects missing followerAddress', async () => {
    const errs = await errors(FollowDto, {});
    expect(errs.some(e => e.property === 'followerAddress')).toBe(true);
  });

  it('rejects non-string followerAddress', async () => {
    const errs = await errors(FollowDto, { followerAddress: 123 });
    expect(errs.some(e => e.property === 'followerAddress')).toBe(true);
  });

  it('accepts a valid followerAddress', async () => {
    expect(await errors(FollowDto, { followerAddress: VALID_STELLAR })).toHaveLength(0);
  });
});

// ─── 5. GetNotificationsDto ──────────────────────────────────────────────────
describe('GetNotificationsDto validation (endpoint: GET /notifications)', () => {
  it('rejects missing userId', async () => {
    const errs = await errors(GetNotificationsDto, {});
    expect(errs.some(e => e.property === 'userId')).toBe(true);
  });

  it('rejects limit below 1', async () => {
    const errs = await errors(GetNotificationsDto, { userId: 'user1', limit: 0 });
    expect(errs.some(e => e.property === 'limit')).toBe(true);
  });

  it('accepts valid payload with all fields', async () => {
    expect(await errors(GetNotificationsDto, { userId: 'user1', limit: 10, offset: 0 })).toHaveLength(0);
  });
});
