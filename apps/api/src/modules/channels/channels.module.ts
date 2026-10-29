import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto.service';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';

@Module({ controllers: [ChannelsController], providers: [ChannelsService, CryptoService], exports: [ChannelsService] })
export class ChannelsModule {}
