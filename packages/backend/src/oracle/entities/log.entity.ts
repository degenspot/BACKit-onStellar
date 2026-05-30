import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('price_deviation_log')
export class PriceDeviationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  symbol: string;

  @Column('decimal', { precision: 20, scale: 8 })
  oraclePrice: number;

  @Column('decimal', { precision: 20, scale: 8 })
  referencePrice: number;

  @Column('decimal', { precision: 10, scale: 4 })
  deviationPercent: number;

  @Column()
  thresholdPercent: number;

  @Column()
  breached: boolean;
  @Column({ default: false })
  signingHalted: boolean;

  @CreateDateColumn()
  checkedAt: Date;
}
