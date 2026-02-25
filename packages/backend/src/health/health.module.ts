import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';

@Module({
  imports: [
    HttpModule,           // provides HttpService for Stellar RPC ping
  ],
  controllers: [HealthController],
  // DataSource is provided globally by TypeOrmModule.forRoot() in AppModule
  // so it can be injected directly — no extra registration needed here
})
export class HealthModule {}