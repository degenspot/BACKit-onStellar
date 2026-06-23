import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { Badge } from './badge.entity';
import { Follow } from './follow.entity';

@Entity('users')
export class Users {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  walletAddress: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string;

  @Column({ type: 'varchar', length: 10, unique: true, nullable: true })
  referralCode: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  displayName: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  bio: string;

  @Column({ type: 'varchar', nullable: true })
  avatarCid: string;

  @ManyToOne(() => Users, { nullable: true, onDelete: 'SET NULL' })
  referredBy: Users | null;

  @OneToMany(() => Follow, (follow) => follow.follower)
  following: Follow[];

  @OneToMany(() => Follow, (follow) => follow.following)
  followers: Follow[];

  // ─── badges ────────────────────────────────────────────────────────────
  @ManyToMany(() => Badge, (badge) => badge.users, { eager: false })
  @JoinTable({
    name: 'user_badges',
    joinColumn: { name: 'userId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'badgeId', referencedColumnName: 'id' },
  })
  badges: Badge[];

  @Column({ type: 'boolean', default: false })
  banned: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
