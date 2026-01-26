import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmConfig } from './config/database.config';
import { HealthModule } from './health/health.module';
import { OracleModule } from './oracle/oracle.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: (env) => {
        const requiredVars = [
          'POSTGRES_HOST',
          'POSTGRES_PORT',
          'POSTGRES_USER',
          'POSTGRES_PASSWORD',
          'POSTGRES_DB',
          'PORT',
        ];
        requiredVars.forEach((key) => {
          if (!env[key]) {
            throw new Error(`Missing env var ${key}`);
          }
        });
        return env;
      },
    }),
    TypeOrmModule.forRoot(typeOrmConfig),
    HealthModule,
    OracleModule,
  ],
})
export class AppModule { }
