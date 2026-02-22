import { Column, Entity } from 'typeorm';

@Entity('users')
export class Users {
  @Column({ type: 'tsvector', nullable: true })
  searchVector: string;
}
