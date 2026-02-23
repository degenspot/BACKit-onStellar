import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions, Between, FindOptionsWhere } from 'typeorm';
import { AuditLog, AuditActionType, AuditStatus } from './audit-log.entity';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

export interface WriteAuditLogParams {
  actorId: string;
  actionType: AuditActionType;
  targetResource: string;
  requestPayload?: Record<string, unknown> | null;
  responsePayload?: Record<string, unknown> | null;
  httpStatus: number;
  status: AuditStatus;
  note?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  /**
   * Persist a single audit log entry.
   * Called by the AuditInterceptor; should never throw — failures are swallowed
   * and logged to stderr so they never break the admin request itself.
   */
  async write(params: WriteAuditLogParams): Promise<void> {
    try {
      const entry = this.auditRepo.create({
        actorId: params.actorId,
        actionType: params.actionType,
        targetResource: params.targetResource,
        requestPayload: params.requestPayload ?? null,
        responsePayload: params.responsePayload ?? null,
        httpStatus: params.httpStatus,
        status: params.status,
        note: params.note ?? null,
      });
      await this.auditRepo.save(entry);
    } catch (err) {
      // Log but never bubble — audit failures must not break admin operations
      this.logger.error('Failed to persist audit log entry', (err as Error).stack);
    }
  }

  /**
   * Query audit logs with optional filters.
   * Returns paginated results ordered newest-first.
   */
  async findAll(query: QueryAuditLogsDto): Promise<{ data: AuditLog[]; total: number }> {
    const {
      actorId,
      actionType,
      status,
      targetResource,
      from,
      to,
      page = 1,
      limit = 50,
    } = query;

    const where: FindOptionsWhere<AuditLog> = {};

    if (actorId) where.actorId = actorId;
    if (actionType) where.actionType = actionType;
    if (status) where.status = status;
    if (targetResource) where.targetResource = targetResource;
    if (from && to) where.timestamp = Between(new Date(from), new Date(to));

    const [data, total] = await this.auditRepo.findAndCount({
      where,
      order: { timestamp: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total };
  }

  /** Fetch a single log entry by ID. */
  async findOne(id: string): Promise<AuditLog | null> {
    return this.auditRepo.findOneBy({ id });
  }
}