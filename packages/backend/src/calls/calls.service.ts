import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallsRepository } from './calls.repository';
import { CallReport } from './entities/call-report.entity';
import { Call, CallStatus } from './entities/call.entity';
import { ReportCallDto } from './dto/report-call.dto';
import { QueryCallsDto } from './dto/query-calls.dto';
import { REPORT_THRESHOLD } from './constants/moderation.constants';
import { OracleService } from '../oracle/oracle.service';

@Injectable()
export class CallsService {
  constructor(
    private readonly callsRepository: CallsRepository,
    @InjectRepository(CallReport)
    private readonly callReportRepository: Repository<CallReport>,
    @Inject(forwardRef(() => OracleService))
    private readonly oracleService: OracleService,
  ) {}

  // ─── Feed & Search ────────────────────────────────────────────────────────

  async getFeed(query: QueryCallsDto) {
    const { page = 1, limit = 20 } = query;
    const [data, total] = await this.callsRepository.findFeed(page, limit);
    return { data, total, page, limit };
  }

  async search(query: QueryCallsDto) {
    const { search = '', page = 1, limit = 20 } = query;
    const [data, total] = await this.callsRepository.searchVisible(
      search,
      page,
      limit,
    );
    return { data, total, page, limit };
  }

  // ─── Single Call Lookup ───────────────────────────────────────────────────

  async getCallOrThrow(id: string): Promise<Call> {
    const call = await this.callsRepository.findOne({ where: { id } });
    if (!call) throw new NotFoundException(`Call ${id} not found`);
    return call;
  }

  // ─── Reporting & Auto-Pause (circuit breaker) ─────────────────────────────

  async reportCall(
    id: string,
    reporterAddress: string,
    dto: ReportCallDto,
  ) {
    const call = await this.getCallOrThrow(id);

    const nonReportable: CallStatus[] = [
      CallStatus.RESOLVED_YES,
      CallStatus.RESOLVED_NO,
    ];
    if (nonReportable.includes(call.status)) {
      throw new BadRequestException('Cannot report a resolved market');
    }

    const alreadyReported = await this.callReportRepository.findOne({
      where: { callId: id, reporterAddress },
    });
    if (alreadyReported) {
      throw new ConflictException('You have already reported this call');
    }

    await this.callReportRepository.save(
      this.callReportRepository.create({
        callId: id,
        reporterAddress,
        reason: dto.reason,
      }),
    );

    const updated = await this.oracleService.recordReport(Number(id));

    return {
      message: 'Report submitted successfully',
      reportCount: updated.reportCount,
      isHidden: updated.isHidden,
      status: updated.status,
    };
  }

  // ─── Admin: Unpause ───────────────────────────────────────────────────────

  async unpauseCall(id: string): Promise<Call> {
    const call = await this.getCallOrThrow(id);

    if (call.status !== CallStatus.PAUSED) {
      throw new BadRequestException(
        `Call is not paused (current status: ${call.status})`,
      );
    }

    call.status = CallStatus.OPEN;
    return this.callsRepository.save(call);
  }

  // ─── Admin: Force Resolve ─────────────────────────────────────────────────

  async adminResolveCall(
    id: string,
    resolution: CallStatus.RESOLVED_YES | CallStatus.RESOLVED_NO,
    finalPrice?: string,
  ): Promise<Call> {
    const call = await this.getCallOrThrow(id);

    const resolvable: CallStatus[] = [
      CallStatus.OPEN,
      CallStatus.PAUSED,
      CallStatus.SETTLING,
    ];

    if (!resolvable.includes(call.status)) {
      throw new BadRequestException(
        `Cannot resolve a call with status ${call.status}`,
      );
    }

    call.status     = resolution;
    call.resolvedAt = new Date();
    if (finalPrice !== undefined) call.finalPrice = finalPrice;

    return this.callsRepository.save(call);
  }
}