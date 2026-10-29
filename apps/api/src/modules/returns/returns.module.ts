import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

@Module({ imports: [ChannelsModule], controllers: [ReturnsController], providers: [ReturnsService], exports: [ReturnsService] })
export class ReturnsModule {}
