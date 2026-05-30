import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('oracle_prices')
export class OraclePriceEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 32 })
  symbol: string;

  @Column('decimal', { precision: 20, scale: 8 })
  usdPrice: number;

  @CreateDateColumn()
  createdAt: Date;
}
