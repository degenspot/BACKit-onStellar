import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('calls')
@Index(['creatorAddress', 'createdAt'])
@Index(['outcome', 'resolvedAt'])
export class Call {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 56 })
  @Index()
  creatorAddress: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: ['YES', 'NO', 'PENDING'], default: 'PENDING' })
  @Index()
  outcome: 'YES' | 'NO' | 'PENDING';

  @Column({ type: 'timestamp', nullable: true })
  @Index()
  resolvedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @CreateDateColumn()
  @Index()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  contractAddress?: string;

  @Column({ type: 'decimal', precision: 20, scale: 7, default: 0 })
  totalYesStake: number;

  @Column({ type: 'decimal', precision: 20, scale: 7, default: 0 })
  totalNoStake: number;
}
