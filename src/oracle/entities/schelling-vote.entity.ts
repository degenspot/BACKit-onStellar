import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { IsUUID, IsHexadecimal, IsNumber, IsBoolean, IsDateString } from 'class-validator';

@Entity()
export class SchellingVote {
  @PrimaryGeneratedColumn('uuid')
  @IsUUID()
  id: string;

  @Column({ type: 'varchar', length: 64 })
  @IsHexadecimal()
  voterAddress: string;

  @Column({ type: 'varchar', length: 64 })
  @IsHexadecimal()
  commitmentHash: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  @IsHexadecimal('strict', 64)
  revealedSalt: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 10 })
  @IsNumber()
  revealedPrice: string;

  @Column({ type: 'timestamp' })
  @IsDateString()
  commitTimestamp: Date;

  @Column({ type: 'timestamp', nullable: true })
  @IsDateString()
  revealTimestamp: Date | null;

  @Column({ type: 'boolean', default: false })
  @IsBoolean()
  isConsensus: boolean;

  @Column({ type: 'boolean', default: false })
  @IsBoolean()
  isSlashed: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'varchar', length: 64, nullable: true })
  @IsHexadecimal('strict', 64)
  disputeTxHash: string | null;
}