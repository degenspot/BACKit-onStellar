import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('GraphQL API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const runQuery = (query: string, variables = {}) => {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({
        query,
        variables,
      });
  };

  it('1. should query calls with filter, sort, pagination and resolve nested creator', async () => {
    const query = `
      query GetCalls {
        calls(filter: { status: "OPEN" }, sort: "createdAt_DESC", limit: 10, offset: 0) {
          id
          title
          status
          creator {
            id
            walletAddress
          }
        }
      }
    `;

    const response = await runQuery(query);
    expect(response.status).toBe(200);
    // Even if no data in db, it should return an array
    expect(response.body.errors).toBeUndefined();
    expect(Array.isArray(response.body.data.calls)).toBe(true);
  });

  it('2. should query a user by address and resolve followers/following', async () => {
    const query = `
      query GetUser($address: String!) {
        user(address: $address) {
          id
          walletAddress
          displayName
          followers(limit: 5) {
            id
            walletAddress
          }
          following(limit: 5) {
            id
            walletAddress
          }
        }
      }
    `;

    const response = await runQuery(query, { address: '0x123' });
    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    // In our mock or empty DB it might return null, which is valid for an unknown user
  });

  it('3. should query personalized feed', async () => {
    const query = `
      query GetFeed($type: String!) {
        feed(type: $type) {
          id
          title
          creator {
            walletAddress
          }
        }
      }
    `;

    const response = await runQuery(query, { type: 'TRENDING' });
    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(Array.isArray(response.body.data.feed)).toBe(true);
  });

  it('4. should query leaderboard by period', async () => {
    const query = `
      query GetLeaderboard($period: String!) {
        leaderboard(period: $period) {
          rank
          user {
            walletAddress
            displayName
          }
          score
          winRate
        }
      }
    `;

    const response = await runQuery(query, { period: 'WEEKLY' });
    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(Array.isArray(response.body.data.leaderboard)).toBe(true);
  });

  it('5. should query global search', async () => {
    const query = `
      query GlobalSearch($query: String!) {
        search(query: $query) {
          calls {
            id
            title
          }
          users {
            id
            walletAddress
          }
        }
      }
    `;

    const response = await runQuery(query, { query: 'test' });
    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.search).toBeDefined();
    expect(Array.isArray(response.body.data.search.calls)).toBe(true);
    expect(Array.isArray(response.body.data.search.users)).toBe(true);
  });
});
