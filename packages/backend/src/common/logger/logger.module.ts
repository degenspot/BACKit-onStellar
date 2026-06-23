import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { buildLoggerConfig } from './logger.config';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      useFactory: buildLoggerConfig,
    }),
  ],
})
export class LoggerModule {}
