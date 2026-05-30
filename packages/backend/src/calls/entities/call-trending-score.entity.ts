import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('call_trending_scores')
@Index(['score', 'updatedAt'])
export class CallTrendingScore {
  @PrimaryColumn({ type: 'uuid' })
  callId: string;

  @Column({ type: 'decimal', precision: 30, scale: 10, default: 0 })
  score: string;

  @Column({ type: 'decimal', precision: 30, scale: 10, default: 0 })
  stakeVolume24h: string;

  @Column({ type: 'int', default: 0 })
  stakerCount24h: number;

  @Column({ type: 'decimal', precision: 30, scale: 10, default: 0 })
  recencyBonus: string;

  @Column({ type: 'decimal', precision: 30, scale: 10, default: 1 })
  timeDecay: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

