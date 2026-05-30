import { Entity } from 'typeorm';

@Entity('price_deviation_log')
export class StoredOraclePrice {
  symbol: string;
  usdPrice: number;
}

@Entity('oracle-price')
export class OraclePriceEntity {
  symbol: string;
  usdPrice: number;
}
