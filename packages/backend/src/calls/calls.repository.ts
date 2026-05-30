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
