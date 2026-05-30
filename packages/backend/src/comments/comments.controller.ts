import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('comments')
@Controller('calls/:id/comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Create a comment or reply on a call',
    description:
      'Creates a comment. Maximum 100 comments per call, and maximum 20 comments per user per call.',
  })
  @ApiParam({ name: 'id', description: 'Call UUID', example: 'a6b8e8f8-dcd6-4e5a-93ef-fc1533fb85a6' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Comment created successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input or validation limits exceeded',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized access',
  })
  async createComment(
    @Param('id') callId: string,
    @Request() req: any,
    @Body(new ValidationPipe({ transform: true })) dto: CreateCommentDto,
  ) {
    return this.commentsService.createComment(callId, req.user.address, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get paginated, threaded comments for a call',
    description:
      'Returns a list of comments, grouping replies chronologically under their parent comments.',
  })
  @ApiParam({ name: 'id', description: 'Call UUID', example: 'a6b8e8f8-dcd6-4e5a-93ef-fc1533fb85a6' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Comments retrieved successfully',
  })
  async getComments(
    @Param('id') callId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const pageNum = page ? parseInt(String(page), 10) : 1;
    const limitNum = limit ? parseInt(String(limit), 10) : 20;
    return this.commentsService.getComments(callId, pageNum, limitNum);
  }

  @Delete(':commentId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Delete a comment',
    description: 'Deletes a comment. Only the author or an admin can delete a comment.',
  })
  @ApiParam({ name: 'id', description: 'Call UUID', example: 'a6b8e8f8-dcd6-4e5a-93ef-fc1533fb85a6' })
  @ApiParam({ name: 'commentId', description: 'Comment UUID', example: 'f8c7e8d6-a4c6-4e3a-82ef-fb1533fb22c1' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Comment deleted successfully',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Forbidden - not authorized to delete this comment',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Comment not found',
  })
  async deleteComment(
    @Param('id') callId: string,
    @Param('commentId') commentId: string,
    @Request() req: any,
  ) {
    return this.commentsService.deleteComment(callId, commentId, req.user);
  }
}
