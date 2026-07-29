import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventStoreEntry } from './entities/event-store-entry.entity';
import { AggregateSnapshot } from './entities/aggregate-snapshot.entity';
import { EventStoreService } from './event-store.service';
import { EventStoreListener } from './event-store.listener';
import { EventsController } from './events.controller';

@Module({
  imports: [TypeOrmModule.forFeature([EventStoreEntry, AggregateSnapshot])],
  providers: [EventStoreService, EventStoreListener],
  controllers: [EventsController],
  exports: [EventStoreService],
})
export class EventStoreModule {}
