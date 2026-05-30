import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../../app.module';
import { CommentsService } from '../comments.service';
import { Call, CallStatus } from '../../calls/entities/call.entity';

describe('CommentsController (e2e)', () => {
  let app: INestApplication;
  let commentsService: CommentsService;
  let callRepository: Repository<Call>;
  let testCallId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    commentsService = moduleFixture.get<CommentsService>(CommentsService);
    callRepository = moduleFixture.get<Repository<Call>>(getRepositoryToken(Call));
    await app.init();

    // Create a test call to use in comment tests
    const call = await callRepository.save(
      callRepository.create({
        title: 'Comment Test Call',
        description: 'This is a test call for comments',
        creatorAddress: 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
        status: CallStatus.OPEN,
        isHidden: false,
      }),
    );
    testCallId = call.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /calls/:id/comments', () => {
    it('should create a comment successfully', async () => {
      const payload = { content: 'My first comment!' };
      return request(app.getHttpServer())
        .post(`/calls/${testCallId}/comments`)
        .send(payload)
        .expect(HttpStatus.CREATED)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.content).toBe(payload.content);
          expect(res.body.callId).toBe(testCallId);
        });
    });

    it('should fail if content length is 0', async () => {
      return request(app.getHttpServer())
        .post(`/calls/${testCallId}/comments`)
        .send({ content: '' })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('should fail if content exceeds 2000 chars', async () => {
      const longContent = 'a'.repeat(2001);
      return request(app.getHttpServer())
        .post(`/calls/${testCallId}/comments`)
        .send({ content: longContent })
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('GET /calls/:id/comments', () => {
    it('should retrieve threaded comments list', async () => {
      // Create a parent comment
      const parent = await commentsService.createComment(
        testCallId,
        'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
        { content: 'Parent' },
      );

      // Create a reply comment
      await commentsService.createComment(
        testCallId,
        'another-address',
        { content: 'Reply', parentId: parent.id },
      );

      return request(app.getHttpServer())
        .get(`/calls/${testCallId}/comments?page=1&limit=10`)
        .expect(HttpStatus.OK)
        .expect((res) => {
          expect(res.body).toHaveProperty('data');
          expect(res.body).toHaveProperty('total');
          const data = res.body.data;
          const parentItem = data.find((item: any) => item.id === parent.id);
          expect(parentItem).toBeDefined();
          expect(parentItem.replies).toHaveLength(1);
          expect(parentItem.replies[0].content).toBe('Reply');
        });
    });
  });

  describe('DELETE /calls/:id/comments/:commentId', () => {
    it('should delete a comment as author or admin', async () => {
      const comment = await commentsService.createComment(
        testCallId,
        'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ', // matches auth guard default address
        { content: 'Delete me' },
      );

      return request(app.getHttpServer())
        .delete(`/calls/${testCallId}/comments/${comment.id}`)
        .expect(HttpStatus.OK);
    });
  });
});
