import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Token } from './entities/token.entity';

@Injectable()
export class TokensRepository extends Repository<Token> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(Token, dataSource.createEntityManager());
  }

  findAllActive(): Promise<Token[]> {
    return this.find({ where: { isActive: true }, order: { assetCode: 'ASC' } });
  }

  findByAsset(assetCode: string, assetIssuer: string | null): Promise<Token | null> {
    return this.findOne({ where: { assetCode, assetIssuer } });
  }
}