import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto.service';
import { ChannelsModule } from '../channels/channels.module';
import { ListingsModule } from '../listings/listings.module';
import { OrdersModule } from '../orders/orders.module';
import { SyncController } from './sync.controller';
import { SyncQueue } from './sync.queue';
import { SyncScheduler } from './sync.scheduler';
import { SyncService } from './sync.service';

@Module({
  imports: [ChannelsModule, ListingsModule, OrdersModule],
  controllers: [SyncController],
  providers: [SyncService, SyncQueue, SyncScheduler, CryptoService],
  exports: [SyncService, SyncQueue],
})
export class SyncModule {}
