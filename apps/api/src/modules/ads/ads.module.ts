import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { AdsController } from './ads.controller';
import { AdsService } from './ads.service';

@Module({ imports: [ChannelsModule], controllers: [AdsController], providers: [AdsService], exports: [AdsService] })
export class AdsModule {}
