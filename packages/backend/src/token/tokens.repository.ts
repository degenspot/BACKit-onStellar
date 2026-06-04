import { Injectable } from '@nestjs/common';
import { DataSource, Repository, IsNull } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Token } from './entities/token.entity';

@Injectable()
export class TokensRepository extends Repository<Token> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(Token, dataSource.createEntityManager());
  }

  findAllActive(): Promise<Token[]> {
    return this.find({
      where: { isActive: true },
      order: { assetCode: 'ASC' },
    });
  }

  findWhitelisted(): Promise<Token[]> {
    return this.find({
      where: { isWhitelisted: true, isActive: true },
      order: { assetCode: 'ASC' },
    });
  }

  findById(id: string): Promise<Token | null> {
    return this.findOne({ where: { id } });
  }

  findByAsset(
    assetCode: string,
    assetIssuer: string | null,
  ): Promise<Token | null> {
    return this.findOne({
      where: {
        assetCode,
        assetIssuer: assetIssuer ?? IsNull(),
      },
    });
  }
}
