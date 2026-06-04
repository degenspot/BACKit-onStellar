import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { Comment } from './entities/comment.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CallsService } from '../calls/calls.service';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    private readonly callsService: CallsService,
  ) {}

  /**
   * Create a comment or reply on a call
   */
  async createComment(
    callId: string,
    authorAddress: string,
    dto: CreateCommentDto,
  ): Promise<Comment> {
    // 1. Verify call exists
    await this.callsService.getCallOrThrow(callId);

    // 2. Enforce total comment limits (max 100 comments per call)
    const totalCount = await this.commentRepository.count({
      where: { callId },
    });
    if (totalCount >= 100) {
      throw new BadRequestException('Max 100 comments reached for this call');
    }

    // 3. Enforce author comment limits (max 20 comments per user per call)
    const userCount = await this.commentRepository.count({
      where: { callId, authorAddress },
    });
    if (userCount >= 20) {
      throw new BadRequestException(
        'Max 20 comments reached per user for this call',
      );
    }

    // 4. Validate parent comment if it is a reply
    if (dto.parentId) {
      const parent = await this.commentRepository.findOne({
        where: { id: dto.parentId },
      });
      if (!parent) {
        throw new BadRequestException('Parent comment not found');
      }
      if (parent.callId !== callId) {
        throw new BadRequestException(
          'Parent comment belongs to a different call',
        );
      }
    }

    // 5. Save comment
    const comment = this.commentRepository.create({
      callId,
      authorAddress,
      content: dto.content,
      parentId: dto.parentId || null,
    });

    return this.commentRepository.save(comment);
  }

  /**
   * Get threaded and paginated comments for a call
   */
  async getComments(
    callId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    // 1. Verify call exists
    await this.callsService.getCallOrThrow(callId);

    // 2. Count parent comments
    const total = await this.commentRepository.count({
      where: { callId, parentId: IsNull() },
    });

    // 3. Fetch paginated parent comments
    const parents = await this.commentRepository.find({
      where: { callId, parentId: IsNull() },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    if (parents.length === 0) {
      return { data: [], total, page, limit };
    }

    // 4. Fetch replies for these parent comments
    const parentIds = parents.map((p) => p.id);
    const replies = await this.commentRepository.find({
      where: {
        callId,
        parentId: In(parentIds),
      },
      order: { createdAt: 'ASC' },
    });

    // 5. Group replies under parent comments
    const repliesMap = new Map<string, Comment[]>();
    for (const reply of replies) {
      if (reply.parentId) {
        if (!repliesMap.has(reply.parentId)) {
          repliesMap.set(reply.parentId, []);
        }
        repliesMap.get(reply.parentId)!.push(reply);
      }
    }

    const data = parents.map((parent) => ({
      ...parent,
      replies: repliesMap.get(parent.id) || [],
    }));

    return { data, total, page, limit };
  }

  /**
   * Delete a comment by ID (author or admin only)
   */
  async deleteComment(
    callId: string,
    commentId: string,
    user: { address: string; isAdmin?: boolean },
  ): Promise<{ message: string }> {
    const comment = await this.commentRepository.findOne({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException(`Comment ${commentId} not found`);
    }

    if (comment.callId !== callId) {
      throw new BadRequestException(
        `Comment ${commentId} does not belong to call ${callId}`,
      );
    }

    // Enforce author or admin check
    if (comment.authorAddress !== user.address && !user.isAdmin) {
      throw new ForbiddenException(
        'You are not authorized to delete this comment',
      );
    }

    await this.commentRepository.remove(comment);

    return { message: 'Comment deleted successfully' };
  }
}
