import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OracleSigningService } from './services/oracle-signing.service';
import { OracleController } from './oracle.controller';

@Module({
  imports: [ConfigModule],
  controllers: [OracleController],
  providers: [OracleSigningService],
  exports: [OracleSigningService],
})
export class OracleModule {}
