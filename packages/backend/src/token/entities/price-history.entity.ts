import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('token_price_history')
@Index(['tokenPair', 'timestamp'])
export class PriceHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  tokenPair: string;

  @Column({ type: 'timestamptz' })
  timestamp: Date;

  @Column({ type: 'numeric', precision: 30, scale: 10 })
  price: number;

  @Column({ type: 'varchar', length: 50, default: 'dexscreener' })
  source: string;
}
