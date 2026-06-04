import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { CommentsService } from '../comments.service';
import { Comment } from '../entities/comment.entity';
import { CallsService } from '../../calls/calls.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

describe('CommentsService', () => {
  let service: CommentsService;
  let commentRepository: jest.Mocked<any>;
  let callsService: jest.Mocked<any>;

  const mockCommentRepository = {
    create: jest.fn(),
    save: jest.fn(),
    count: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    remove: jest.fn(),
  };

  const mockCallsService = {
    getCallOrThrow: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        {
          provide: getRepositoryToken(Comment),
          useValue: mockCommentRepository,
        },
        {
          provide: CallsService,
          useValue: mockCallsService,
        },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
    commentRepository = module.get(getRepositoryToken(Comment));
    callsService = module.get(CallsService);

    jest.clearAllMocks();
  });

  describe('createComment', () => {
    it('should successfully create a top-level comment', async () => {
      const callId = 'call-uuid';
      const authorAddress =
        'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ';
      const dto = { content: 'Nice trade!' };

      callsService.getCallOrThrow.mockResolvedValue(true);
      commentRepository.count.mockResolvedValueOnce(0); // total count
      commentRepository.count.mockResolvedValueOnce(0); // user count

      const createdComment = {
        id: 'comment-uuid',
        callId,
        authorAddress,
        content: dto.content,
        parentId: null,
      };

      commentRepository.create.mockReturnValue(createdComment);
      commentRepository.save.mockResolvedValue(createdComment);

      const result = await service.createComment(callId, authorAddress, dto);

      expect(callsService.getCallOrThrow).toHaveBeenCalledWith(callId);
      expect(commentRepository.count).toHaveBeenCalledTimes(2);
      expect(commentRepository.create).toHaveBeenCalledWith({
        callId,
        authorAddress,
        content: dto.content,
        parentId: null,
      });
      expect(result).toEqual(createdComment);
    });

    it('should successfully create a nested reply comment', async () => {
      const callId = 'call-uuid';
      const authorAddress =
        'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ';
      const parentId = 'parent-comment-uuid';
      const dto = { content: 'I agree!', parentId };

      callsService.getCallOrThrow.mockResolvedValue(true);
      commentRepository.count.mockResolvedValueOnce(5); // total count
      commentRepository.count.mockResolvedValueOnce(1); // user count

      const parentComment = {
        id: parentId,
        callId,
        authorAddress: 'another-user',
        content: 'Main post',
      };
      commentRepository.findOne.mockResolvedValue(parentComment);

      const replyComment = {
        id: 'reply-uuid',
        callId,
        authorAddress,
        content: dto.content,
        parentId,
      };
      commentRepository.create.mockReturnValue(replyComment);
      commentRepository.save.mockResolvedValue(replyComment);

      const result = await service.createComment(callId, authorAddress, dto);

      expect(commentRepository.findOne).toHaveBeenCalledWith({
        where: { id: parentId },
      });
      expect(result).toEqual(replyComment);
    });

    it('should throw BadRequestException if call is full (limit 100 comments)', async () => {
      const callId = 'call-uuid';
      const authorAddress =
        'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ';
      const dto = { content: 'Too late comment' };

      callsService.getCallOrThrow.mockResolvedValue(true);
      commentRepository.count.mockResolvedValueOnce(100); // total count hit!

      await expect(
        service.createComment(callId, authorAddress, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if user limit reached (limit 20 comments)', async () => {
      const callId = 'call-uuid';
      const authorAddress =
        'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ';
      const dto = { content: 'Spamming comment' };

      callsService.getCallOrThrow.mockResolvedValue(true);
      commentRepository.count.mockResolvedValueOnce(50); // total count under 100
      commentRepository.count.mockResolvedValueOnce(20); // user count hit!

      await expect(
        service.createComment(callId, authorAddress, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if parent comment belongs to a different call', async () => {
      const callId = 'call-uuid';
      const authorAddress =
        'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ';
      const parentId = 'parent-comment-uuid';
      const dto = { content: 'Reply content', parentId };

      callsService.getCallOrThrow.mockResolvedValue(true);
      commentRepository.count.mockResolvedValueOnce(0);
      commentRepository.count.mockResolvedValueOnce(0);

      const parentComment = {
        id: parentId,
        callId: 'different-call-uuid', // mismatch!
        authorAddress: 'another-user',
        content: 'Main post',
      };
      commentRepository.findOne.mockResolvedValue(parentComment);

      await expect(
        service.createComment(callId, authorAddress, dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getComments', () => {
    it('should paginate top-level comments and group replies', async () => {
      const callId = 'call-uuid';
      callsService.getCallOrThrow.mockResolvedValue(true);

      commentRepository.count.mockResolvedValue(2);

      const parents = [
        {
          id: 'parent-1',
          callId,
          content: 'Comment 1',
          parentId: null,
          createdAt: new Date(),
        },
        {
          id: 'parent-2',
          callId,
          content: 'Comment 2',
          parentId: null,
          createdAt: new Date(),
        },
      ];
      commentRepository.find.mockResolvedValueOnce(parents); // First find is for parents

      const replies = [
        {
          id: 'reply-1',
          callId,
          content: 'Reply to 1',
          parentId: 'parent-1',
          createdAt: new Date(),
        },
      ];
      commentRepository.find.mockResolvedValueOnce(replies); // Second find is for replies

      const result = await service.getComments(callId, 1, 10);

      expect(commentRepository.count).toHaveBeenCalledWith({
        where: { callId, parentId: IsNull() },
      });
      expect(result.total).toBe(2);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].replies).toHaveLength(1);
      expect(result.data[0].replies[0]).toEqual(replies[0]);
      expect(result.data[1].replies).toHaveLength(0);
    });
  });

  describe('deleteComment', () => {
    it('should delete if requester is the author', async () => {
      const callId = 'call-uuid';
      const commentId = 'comment-uuid';
      const user = { address: 'author-address', isAdmin: false };

      const comment = {
        id: commentId,
        callId,
        authorAddress: 'author-address',
        content: 'My post',
      };

      commentRepository.findOne.mockResolvedValue(comment);
      commentRepository.remove.mockResolvedValue(comment);

      const result = await service.deleteComment(callId, commentId, user);

      expect(commentRepository.findOne).toHaveBeenCalledWith({
        where: { id: commentId },
      });
      expect(commentRepository.remove).toHaveBeenCalledWith(comment);
      expect(result.message).toContain('deleted successfully');
    });

    it('should delete if requester is admin', async () => {
      const callId = 'call-uuid';
      const commentId = 'comment-uuid';
      const user = { address: 'admin-address', isAdmin: true };

      const comment = {
        id: commentId,
        callId,
        authorAddress: 'author-address',
        content: 'User post',
      };

      commentRepository.findOne.mockResolvedValue(comment);
      commentRepository.remove.mockResolvedValue(comment);

      const result = await service.deleteComment(callId, commentId, user);

      expect(result.message).toContain('deleted successfully');
    });

    it('should throw ForbiddenException if requester is not author or admin', async () => {
      const callId = 'call-uuid';
      const commentId = 'comment-uuid';
      const user = { address: 'stranger-address', isAdmin: false };

      const comment = {
        id: commentId,
        callId,
        authorAddress: 'author-address',
        content: 'User post',
      };

      commentRepository.findOne.mockResolvedValue(comment);

      await expect(
        service.deleteComment(callId, commentId, user),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if comment does not exist', async () => {
      const callId = 'call-uuid';
      const commentId = 'nonexistent-uuid';
      const user = { address: 'author-address', isAdmin: false };

      commentRepository.findOne.mockResolvedValue(null);

      await expect(
        service.deleteComment(callId, commentId, user),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
