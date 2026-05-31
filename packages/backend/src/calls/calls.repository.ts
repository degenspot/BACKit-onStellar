import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Call, CallStatus } from './entities/call.entity';
import { QueryCallsDto } from './dto/query-calls.dto';

const RESOLVED_STATUSES: CallStatus[] = [
  CallStatus.RESOLVED_YES,
  CallStatus.RESOLVED_NO,
  CallStatus.SETTLING,
];

@Injectable()
export class CallsRepository extends Repository<Call> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(Call, dataSource.createEntityManager());
  }

  visibleQuery(alias = 'call'): SelectQueryBuilder<Call> {
    return this.createQueryBuilder(alias).where(
      `${alias}.isHidden = :isHidden`,
      { isHidden: false },
    );
  }

  async findVisibleById(id: string): Promise<Call | null> {
    return this.visibleQuery().andWhere('call.id = :id', { id }).getOne();
  }

  /**
   * Apply shared filter/sort options from QueryCallsDto to a query builder.
   */
  private applyFilters(
    qb: SelectQueryBuilder<Call>,
    query: QueryCallsDto,
    alias = 'call',
  ): SelectQueryBuilder<Call> {
    // Status filter
    if (query.status) {
      if (query.status === 'RESOLVED') {
        qb.andWhere(`${alias}.status IN (:...resolvedStatuses)`, {
          resolvedStatuses: RESOLVED_STATUSES,
        });
      } else {
        qb.andWhere(`${alias}.status = :status`, { status: query.status });
      }
    }

    // Minimum pool size filter
    if (query.minStake && query.minStake > 0) {
      qb.andWhere(
        `(CAST(${alias}.totalYesStake AS DECIMAL) + CAST(${alias}.totalNoStake AS DECIMAL)) >= :minStake`,
        { minStake: query.minStake },
      );
    }

    return qb;
  }

  /**
   * Apply sort order from QueryCallsDto to a query builder.
   * For trending sort, the caller must have already joined call_trending_scores.
   */
  private applySort(
    qb: SelectQueryBuilder<Call>,
    sort: QueryCallsDto['sort'],
    alias = 'call',
  ): SelectQueryBuilder<Call> {
    switch (sort) {
      case 'trending':
        qb.orderBy('COALESCE(trend.score, 0)', 'DESC').addOrderBy(
          `${alias}.createdAt`,
          'DESC',
        );
        break;
      case 'ending_soon':
        qb.orderBy(`${alias}.endTs`, 'ASC');
        break;
      case 'most_staked':
        qb.orderBy(
          `(CAST(${alias}.totalYesStake AS DECIMAL) + CAST(${alias}.totalNoStake AS DECIMAL))`,
          'DESC',
        );
        break;
      case 'recent':
      default:
        qb.orderBy(`${alias}.createdAt`, 'DESC');
        break;
    }
    return qb;
  }

  async findFeed(
    page: number,
    limit: number,
    query?: QueryCallsDto,
  ): Promise<[Call[], number]> {
    let qb = this.visibleQuery();

    if (query) {
      qb = this.applyFilters(qb, query);
    }

    if (query?.sort === 'trending') {
      qb.leftJoin('call_trending_scores', 'trend', 'trend."callId" = call.id');
    }

    qb = this.applySort(qb, query?.sort ?? 'recent');

    return qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
  }

  async findTrendingFeed(page: number, limit: number): Promise<[Call[], number]> {
    return this.visibleQuery()
      .leftJoin('call_trending_scores', 'trend', 'trend."callId" = call.id')
      .orderBy('COALESCE(trend.score, 0)', 'DESC')
      .addOrderBy('call.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
  }

  async findFeedByFollowing(
    address: string,
    page: number,
    limit: number,
    query?: QueryCallsDto,
  ): Promise<[Call[], number]> {
    let qb = this.visibleQuery().andWhere(
      `call.creatorAddress IN (
        SELECT u_following.walletAddress
        FROM users u_follower
        JOIN user_follows uf ON uf."followerId" = u_follower.id
        JOIN users u_following ON u_following.id = uf."followingId"
        WHERE u_follower.walletAddress = :address
      )`,
      { address },
    );

    if (query) {
      qb = this.applyFilters(qb, query);
    }

    if (query?.sort === 'trending') {
      qb.leftJoin('call_trending_scores', 'trend', 'trend."callId" = call.id');
    }

    qb = this.applySort(qb, query?.sort ?? 'recent');

    return qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
  }

  async searchVisible(
    search: string,
    page: number,
    limit: number,
  ): Promise<[Call[], number]> {
    return this.visibleQuery()
      .andWhere(
        '(LOWER(call.title) LIKE :term OR LOWER(call.description) LIKE :term)',
        { term: `%${search.toLowerCase()}%` },
      )
      .orderBy('call.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
  }
}
