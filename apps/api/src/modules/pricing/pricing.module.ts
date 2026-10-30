import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Module({ imports: [SyncModule], controllers: [PricingController], providers: [PricingService] })
export class PricingModule {}
