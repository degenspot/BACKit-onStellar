import { Injectable } from '@nestjs/common';
import { DataSource, Repository, IsNull } from 'typeorm';  // add IsNull
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
    return this.findOne({
      where: {
        assetCode,
        // ✅ TypeORM requires IsNull() operator — plain null is not accepted in FindOptionsWhere
        assetIssuer: assetIssuer ?? IsNull(),
      },
    });
  }
}