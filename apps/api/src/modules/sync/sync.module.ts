import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto.service';
import { ChannelsModule } from '../channels/channels.module';
import { ListingsModule } from '../listings/listings.module';
import { OrdersModule } from '../orders/orders.module';
import { ReturnsModule } from '../returns/returns.module';
import { SupportModule } from '../support/support.module';
import { AdsModule } from '../ads/ads.module';
import { PrivacyModule } from '../privacy/privacy.module';
import { SyncController } from './sync.controller';
import { SyncQueue } from './sync.queue';
import { SyncScheduler } from './sync.scheduler';
import { SyncService } from './sync.service';

@Module({
  imports: [ChannelsModule, ListingsModule, OrdersModule, ReturnsModule, SupportModule, AdsModule, PrivacyModule],
  controllers: [SyncController],
  providers: [SyncService, SyncQueue, SyncScheduler, CryptoService],
  exports: [SyncService, SyncQueue],
})
export class SyncModule {}
