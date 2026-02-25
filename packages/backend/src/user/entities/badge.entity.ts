import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToMany,
} from 'typeorm';
import { Users } from './users.entity';

export enum BadgeType {
  EARLY_ADOPTER  = 'EARLY_ADOPTER',   // joined in first 30 days of platform
  WHALE          = 'WHALE',           // total stake volume exceeds threshold
  HIGH_ACCURACY  = 'HIGH_ACCURACY',   // win rate >= 70% with >= 10 resolved calls
}

@Entity('badges')
export class Badge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: BadgeType, unique: true })
  type: BadgeType;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  iconUrl: string | null;

  @ManyToMany(() => Users, (user) => user.badges)
  users: Users[];

  @CreateDateColumn()
  createdAt: Date;
}