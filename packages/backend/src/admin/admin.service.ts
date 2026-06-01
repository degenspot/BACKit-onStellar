import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { Call, CallStatus } from '../calls/entities/call.entity';
import { CallReport } from '../calls/entities/call-report.entity';
import { Users } from '../user/entities/users.entity';
import { QueryAdminCallsDto } from './dto/query-admin-calls.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Call)
    private readonly callRepo: Repository<Call>,
    @InjectRepository(CallReport)
    private readonly reportRepo: Repository<CallReport>,
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,
  ) {}

  // ─── Calls ────────────────────────────────────────────────────────────────

  async listCalls(
    query: QueryAdminCallsDto,
  ): Promise<{ data: Call[]; total: number; page: number; limit: number }> {
    const { status, page = 1, limit = 20 } = query;
    const where = status ? { status } : {};
    const [data, total] = await this.callRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  async hideCall(id: string): Promise<Call> {
    const call = await this.findCallOrThrow(id);
    if (call.isHidden) throw new BadRequestException('Call is already hidden');
    call.isHidden = true;
    return this.callRepo.save(call);
  }

  async unhideCall(id: string): Promise<Call> {
    const call = await this.findCallOrThrow(id);
    if (!call.isHidden) throw new BadRequestException('Call is not hidden');
    call.isHidden = false;
    return this.callRepo.save(call);
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  async banUser(address: string): Promise<Users> {
    const user = await this.findUserOrThrow(address);
    if (user.banned) throw new BadRequestException('User is already banned');
    user.banned = true;
    return this.usersRepo.save(user);
  }

  async unbanUser(address: string): Promise<Users> {
    const user = await this.findUserOrThrow(address);
    if (!user.banned) throw new BadRequestException('User is not banned');
    user.banned = false;
    return this.usersRepo.save(user);
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getStats(): Promise<{
    activeUsersToday: number;
    pendingReports: number;
    pausedCalls: number;
  }> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [activeUsersToday, pendingReports, pausedCalls] = await Promise.all([
      // Users created or updated today as a proxy for "active"
      this.usersRepo.count({
        where: { updatedAt: MoreThanOrEqual(startOfDay) },
      }),
      // Reports on calls that are still open/paused (not yet actioned)
      this.reportRepo
        .createQueryBuilder('r')
        .innerJoin(Call, 'c', 'c.id = r."callId"')
        .where('c.status NOT IN (:...resolved)', {
          resolved: [CallStatus.RESOLVED_YES, CallStatus.RESOLVED_NO],
        })
        .getCount(),
      this.callRepo.count({ where: { status: CallStatus.PAUSED } }),
    ]);

    return { activeUsersToday, pendingReports, pausedCalls };
  }

  async listReports(page = 1, limit = 20) {
    const [reports, total] = await this.reportRepo.findAndCount({
      relations: ['call'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const grouped = new Map<
      string,
      { call: Call; reportCount: number; reports: CallReport[] }
    >();
    for (const report of reports) {
      const existing = grouped.get(report.callId);
      if (existing) {
        existing.reportCount += 1;
        existing.reports.push(report);
      } else {
        grouped.set(report.callId, {
          call: report.call,
          reportCount: 1,
          reports: [report],
        });
      }
    }

    return {
      data: Array.from(grouped.values()),
      total,
      page,
      limit,
    };
  }

  async dismissReports(callId: string) {
    const call = await this.findCallOrThrow(callId);
    await this.reportRepo.delete({ callId });
    call.reportCount = 0;
    return this.callRepo.save(call);
  }

  async takeReportAction(callId: string, banCreator = false) {
    const call = await this.findCallOrThrow(callId);
    call.isHidden = true;
    await this.callRepo.save(call);

    if (banCreator) {
      await this.banUser(call.creatorAddress);
    }

    return {
      callId,
      isHidden: true,
      creatorBanned: banCreator,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async findCallOrThrow(id: string): Promise<Call> {
    const call = await this.callRepo.findOneBy({ id });
    if (!call) throw new NotFoundException(`Call ${id} not found`);
    return call;
  }

  private async findUserOrThrow(address: string): Promise<Users> {
    const user = await this.usersRepo.findOneBy({ walletAddress: address });
    if (!user) throw new NotFoundException(`User ${address} not found`);
    return user;
  }
}
