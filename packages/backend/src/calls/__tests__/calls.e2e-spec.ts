import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../app/app.module';
import { CallsService } from '../calls.service';

describe('CallsController (e2e)', () => {
  let app: INestApplication;
  let callsService: CallsService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    callsService = moduleFixture.get<CallsService>(CallsService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /calls', () => {
    it('should return paginated list of calls', async () => {
      // Create some test calls
      await callsService.createDraft({
        title: 'Test Call 1',
        thesis: 'This is a test call',
        tokenAddress:
          'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IK7FH7XBQMG5VHJ3ZR',
        pairId: 'test_pair_id_1',
        stakeToken: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IK7FH7XBQMG5VHJ3ZR',
        stakeAmount: 100,
        endTs: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
      });

      return request(app.getHttpServer())
        .get('/calls')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('data');
          expect(res.body).toHaveProperty('totalCount');
          expect(res.body).toHaveProperty('hasNext');
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    });

    it('should filter calls by status', async () => {
      return request(app.getHttpServer())
        .get('/calls?status=DRAFT')
        .expect(200);
    });

    it('should filter calls by creator', async () => {
      return request(app.getHttpServer())
        .get('/calls?creator=test_address')
        .expect(200);
    });
  });

  describe('GET /calls/:id', () => {
    it('should return a single call by ID', async () => {
      // Create a test call first
      const call = await callsService.createDraft({
        title: 'Test Call Detail',
        thesis: 'This is a test call for detail view',
        tokenAddress:
          'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IK7FH7XBQMG5VHJ3ZR',
        pairId: 'test_pair_id_2',
        stakeToken: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IK7FH7XBQMG5VHJ3ZR',
        stakeAmount: 200,
        endTs: new Date(Date.now() + 86400000).toISOString(),
      });

      return request(app.getHttpServer())
        .get(`/calls/${call.id}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(call.id);
          expect(res.body.title).toBe('Test Call Detail');
        });
    });

    it('should return 404 for non-existent call', async () => {
      return request(app.getHttpServer()).get('/calls/999999').expect(404);
    });
  });

  describe('POST /calls/draft', () => {
    it('should create a new call draft', async () => {
      const newCallData = {
        title: 'New Test Call',
        thesis: 'This is a new test call thesis',
        tokenAddress:
          'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IK7FH7XBQMG5VHJ3ZR',
        pairId: 'test_pair_id_3',
        stakeToken: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IK7FH7XBQMG5VHJ3ZR',
        stakeAmount: 300,
        endTs: new Date(Date.now() + 86400000).toISOString(),
      };

      return request(app.getHttpServer())
        .post('/calls/draft')
        .send(newCallData)
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.title).toBe('New Test Call');
          expect(res.body.thesis).toBe('This is a new test call thesis');
          expect(res.body).toHaveProperty('ipfsCid');
          expect(res.body.status).toBe('DRAFT');
        });
    });

    it('should validate required fields', async () => {
      return request(app.getHttpServer())
        .post('/calls/draft')
        .send({})
        .expect(400); // Validation error expected
    });
  });

  describe('GET /calls/user/:address', () => {
    it('should return calls by user address', async () => {
      const userAddress =
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IK7FH7XBQMG5VHJ3ZR';

      // Create a test call with the user address
      await callsService.createDraft({
        title: 'User Test Call',
        thesis: 'This is a test call for user',
        tokenAddress:
          'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IK7FH7XBQMG5VHJ3ZR',
        pairId: 'test_pair_id_4',
        stakeToken: userAddress,
        stakeAmount: 400,
        endTs: new Date(Date.now() + 86400000).toISOString(),
      });

      return request(app.getHttpServer())
        .get(`/calls/user/${userAddress}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('data');
          expect(res.body).toHaveProperty('totalCount');
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    });
  });

  describe('GET /calls/feed', () => {
    it('should return trending/recent calls for feed', async () => {
      return request(app.getHttpServer())
        .get('/calls/feed')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('data');
          expect(res.body).toHaveProperty('totalCount');
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    });
  });
});
