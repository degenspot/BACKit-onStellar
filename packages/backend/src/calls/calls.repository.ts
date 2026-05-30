import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Call } from './entities/call.entity';

@Injectable()
export class CallsRepository extends Repository<Call> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(Call, dataSource.createEntityManager());
  }

  visibleQuery(alias = 'call'): SelectQueryBuilder<Call> {
    return this.createQueryBuilder(alias).where(
      `${alias}.isHidden = :isHidden`,
      {
        isHidden: false,
      },
    );
  }

  async findVisibleById(id: string): Promise<Call | null> {
    return this.visibleQuery().andWhere('call.id = :id', { id }).getOne();
  }

  async findFeed(page: number, limit: number): Promise<[Call[], number]> {
    return this.visibleQuery()
      .orderBy('call.createdAt', 'DESC')
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
  ): Promise<[Call[], number]> {
    return this.visibleQuery()
      .andWhere(
        `call.creatorAddress IN (
          SELECT u_following.walletAddress
          FROM users u_follower
          JOIN user_follows uf ON uf."followerId" = u_follower.id
          JOIN users u_following ON u_following.id = uf."followingId"
          WHERE u_follower.walletAddress = :address
        )`,
        { address },
      )
      .orderBy('call.createdAt', 'DESC')
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
