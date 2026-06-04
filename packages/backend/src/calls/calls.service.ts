import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallsRepository } from './calls.repository';
import { CallReport } from './entities/call-report.entity';
import { ReportCallDto } from './dto/report-call.dto';
import { QueryCallsDto } from './dto/query-calls.dto';
import { PrepareCallDto } from './dto/prepare-call.dto';
import { REPORT_THRESHOLD } from './constants/moderation.constants';
import { IpfsService } from '../storage/ipfs.service';

@Injectable()
export class CallsService {
  constructor(
    private readonly callsRepository: CallsRepository,
    @InjectRepository(CallReport)
    private readonly callReportRepository: Repository<CallReport>,
    private readonly ipfsService: IpfsService,
  ) {}

  async getFeed(query: QueryCallsDto) {
    const { page = 1, limit = 20 } = query;
    const [data, total] = await this.callsRepository.findFeed(page, limit, query);
    const [data, total] = await this.callsRepository.findFeed(page, limit);
    return { data, total, page, limit };
  }

  async getFollowingFeed(address: string, query: QueryCallsDto) {
    const { page = 1, limit = 20 } = query;
    const [data, total] = await this.callsRepository.findFeedByFollowing(
      address,
      page,
      limit,
    );
    return { data, total, page, limit };
  }

  async search(query: QueryCallsDto) {
    const { search = '', page = 1, limit = 20 } = query;
    const [data, total] = await this.callsRepository.searchVisible(
      search,
      page,
      limit,
      query,
    );
    return { data, total, page, limit };
  }

  async prepareCall(
    dto: PrepareCallDto,
  ): Promise<{ cid: string; ipfsUrl: string }> {
    const content = {
      version: 1,
      title: dto.title,
      thesis: dto.thesis,
      condition: dto.condition,
      tokenPair: dto.tokenPair,
      createdAt: new Date().toISOString(),
    };

    let cid: string;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        cid = await this.ipfsService.pinCallContent({
          title: content.title,
          thesis: content.thesis,
          conditionJson: {
            condition: content.condition,
            tokenPair: content.tokenPair,
          },
          createdAt: content.createdAt,
        });
        break;
      } catch {
        attempts++;
        if (attempts >= maxAttempts)
          throw new Error('IPFS pinning failed after retries');
        await new Promise((r) => setTimeout(r, 1000 * attempts));
      }
    }

    const ipfsUrl = this.ipfsService.getGatewayUrl(cid!);
    return { cid: cid!, ipfsUrl };
  }

  async getCallOrThrow(id: string) {
    const call = await this.callsRepository.findOne({ where: { id } });
    if (!call) throw new NotFoundException('Call not found');
    return call;
  }

  async reportCall(id: string, reporterAddress: string, dto: ReportCallDto) {
    const call = await this.callsRepository.findOne({ where: { id } });
    if (!call) throw new NotFoundException('Call not found');

    const alreadyReported = await this.callReportRepository.findOne({
      where: { callId: id, reporterAddress },
    });
    if (alreadyReported)
      throw new ConflictException('You have already reported this call');

    await this.callReportRepository.save(
      this.callReportRepository.create({
        callId: id,
        reporterAddress,
        reason: dto.reason,
      }),
    );

    call.reportCount += 1;
    if (call.reportCount >= REPORT_THRESHOLD) {
      call.isHidden = true;
    }

    await this.callsRepository.save(call);

    return {
      message: 'Report submitted successfully',
      reportCount: call.reportCount,
      isHidden: call.isHidden,
    };
  }
}
