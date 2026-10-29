import { Module } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { PublishService } from './publish.service';
import { ChannelsModule } from '../channels/channels.module';

@Module({ imports: [ChannelsModule], controllers: [ListingsController], providers: [ListingsService, PublishService], exports: [ListingsService, PublishService] })
export class ListingsModule {}
