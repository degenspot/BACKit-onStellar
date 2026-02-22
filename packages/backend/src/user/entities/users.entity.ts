import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('users')
export class Users {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ unique: true })
  referralCode: string;

  @ManyToOne(() => Users, (user) => user.referrals, { nullable: true })
  @JoinColumn({ name: 'referred_by_id' })
  referredBy?: Users;

  @OneToMany(() => Users, (user) => user.referredBy)
  referrals: Users[];

  @Column({ type: 'tsvector', nullable: true })
  searchVector: string;
}
