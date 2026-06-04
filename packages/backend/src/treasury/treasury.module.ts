import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TreasuryEntry } from './treasury-entry.entity';
import { TreasuryService } from './treasury.service';
import { TreasuryController } from './treasury.controller';
import { PlatformConfigModule } from '../config/config.module';

@Module({
  imports: [TypeOrmModule.forFeature([TreasuryEntry]), PlatformConfigModule],
  providers: [TreasuryService],
  controllers: [TreasuryController],
  exports: [TreasuryService],
})
export class TreasuryModule {}
