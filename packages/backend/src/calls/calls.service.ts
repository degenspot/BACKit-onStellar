import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { CallEntity, CallStatus } from './calls.entity';
export { CallStatus };
import { CreateCallDto } from './dto/create-call.dto';
import { IpfsService } from '../storage/ipfs.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface CallFilter {
  status?: CallStatus;
  creatorAddress?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface PaginatedCalls {
  data: CallEntity[];
  totalCount: number;
  hasNext: boolean;
}

@Injectable()
export class CallsService {
  constructor(
    @InjectRepository(CallEntity)
    private readonly callsRepository: Repository<CallEntity>,
    private readonly ipfsService: IpfsService,
    private readonly notificationsService: NotificationsService,
  ) { }

  async findAll(filters: CallFilter = {}): Promise<PaginatedCalls> {
    const {
      status,
      creatorAddress,
      startDate,
      endDate,
      limit = 20,
      offset = 0
    } = filters;

    const where: FindOptionsWhere<CallEntity> = {};

    if (status) {
      where.status = status;
    }

    if (creatorAddress) {
      where.creatorAddress = creatorAddress;
    }

    if (startDate) {
      where.createdAt = MoreThanOrEqual(startDate);
    }

    if (endDate) {
      where.createdAt = LessThanOrEqual(endDate);
    }

    const [data, totalCount] = await this.callsRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit + 1, // Fetch one extra to check if there's a next page
    });

    // Return only the requested number of items and indicate if there's a next page
    const hasNext = data.length > limit;
    const resultData = hasNext ? data.slice(0, limit) : data;

    return {
      data: resultData,
      totalCount,
      hasNext,
    };
  }

  async findOne(id: number): Promise<CallEntity> {
    const call = await this.callsRepository.findOne({
      where: { id },
    });

    if (!call) {
      throw new NotFoundException(`Call with id ${id} not found`);
    }

    return call;
  }

  async findByUser(address: string, filters: CallFilter = {}): Promise<PaginatedCalls> {
    const { limit = 20, offset = 0 } = filters;

    const [data, totalCount] = await this.callsRepository.findAndCount({
      where: { creatorAddress: address },
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit + 1,
    });

    const hasNext = data.length > limit;
    const resultData = hasNext ? data.slice(0, limit) : data;

    return {
      data: resultData,
      totalCount,
      hasNext,
    };
  }

  async createDraft(createCallDto: CreateCallDto): Promise<CallEntity> {
    // First, pin the content to IPFS
    const ipfsContent = {
      title: createCallDto.title,
      thesis: createCallDto.thesis,
      conditionJson: createCallDto.conditionJson,
      createdAt: new Date().toISOString(),
    };

    try {
      const ipfsCid = await this.ipfsService.pinCallContent(ipfsContent);

      // Create the call entity
      const call = new CallEntity();
      call.title = createCallDto.title;
      call.thesis = createCallDto.thesis;
      call.tokenAddress = createCallDto.tokenAddress;
      call.pairId = createCallDto.pairId;
      call.stakeToken = createCallDto.stakeToken;
      call.stakeAmount = createCallDto.stakeAmount.toString();
      call.endTs = new Date(createCallDto.endTs);
      call.creatorAddress = createCallDto.stakeToken; // Using stakeToken as creator address
      call.ipfsCid = ipfsCid;
      call.status = CallStatus.DRAFT;
      call.conditionJson = createCallDto.conditionJson;

      return await this.callsRepository.save(call);
    } catch (error) {
      throw new BadRequestException(`Failed to create call draft: ${error.message}`);
    }
  }

  async getFeed(filters: CallFilter = {}): Promise<PaginatedCalls> {
    const { limit = 20, offset = 0 } = filters;

    // Get trending/recent calls - ordering by creation date descending
    const [data, totalCount] = await this.callsRepository.findAndCount({
      where: { status: CallStatus.OPEN }, // Only show open calls in feed
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit + 1,
    });

    const hasNext = data.length > limit;
    const resultData = hasNext ? data.slice(0, limit) : data;

    return {
      data: resultData,
      totalCount,
      hasNext,
    };
  }

  // ── Notification trigger stubs (called by indexer after on-chain confirmation) ─

  async notifyBackedCall(callCreatorId: string, backerAddress: string, callId: number): Promise<void> {
    await this.notificationsService.notifyBackedCall(callCreatorId, backerAddress, callId);
  }

  async notifyCallEnded(userId: string, callId: number): Promise<void> {
    await this.notificationsService.notifyCallEnded(userId, callId);
  }

  async notifyPayoutReady(userId: string, callId: number): Promise<void> {
    await this.notificationsService.notifyPayoutReady(userId, callId);
  }
}