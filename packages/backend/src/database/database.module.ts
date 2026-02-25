import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from './data-source';

/**
 * Drop-in replacement for any inline TypeOrmModule.forRoot({ synchronize: true })
 * call that was previously used in AppModule.
 *
 * Migration workflow replaces auto-synchronisation:
 *   npm run typeorm:generate -- src/database/migrations/MyChange
 *   npm run typeorm:run
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...dataSourceOptions,
      // autoLoadEntities lets NestJS feature modules register entities via
      // TypeOrmModule.forFeature() without repeating them in the entities array.
      autoLoadEntities: true,
    }),
  ],
})
export class DatabaseModule {}
