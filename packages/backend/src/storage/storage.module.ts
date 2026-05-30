import { Module } from '@nestjs/common';
import { IpfsService } from './ipfs.service';
import { QueuesModule } from '../common/queues/queues.module';
import { IpfsPinningQueueProcessor } from './ipfs-pinning.queue.processor';
import { IpfsPinningService } from './ipfs-pinning.service';

@Module({
  imports: [QueuesModule],
  providers: [IpfsService, IpfsPinningService, IpfsPinningQueueProcessor],
  exports: [IpfsService, IpfsPinningService],
})
export class StorageModule {}
