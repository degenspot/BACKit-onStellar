import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Users } from './users.entity';

@Entity('follows')
@Unique('UQ_follows_follower_following', [
  'followerAddress',
  'followingAddress',
])
export class Follow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  followerAddress: string;

  @Column({ type: 'varchar', length: 64 })
  followingAddress: string;

  @ManyToOne(() => Users, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'followerAddress',
    referencedColumnName: 'walletAddress',
  })
  follower: Users;

  @ManyToOne(() => Users, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'followingAddress',
    referencedColumnName: 'walletAddress',
  })
  following: Users;

  @CreateDateColumn()
  createdAt: Date;
}
