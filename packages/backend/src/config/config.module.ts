import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformSettings } from './entities/platform-settings.entity';
import { ConfigService } from './config.service';
import { PlatformConfigController } from './config.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformSettings])],
  controllers: [PlatformConfigController],
  providers: [ConfigService],
  exports: [ConfigService], // exported so IndexerService can inject it
})
export class PlatformConfigModule {}