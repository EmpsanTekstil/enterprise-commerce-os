import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

@Module({ imports: [ChannelsModule], controllers: [CategoriesController], providers: [CategoriesService], exports: [CategoriesService] })
export class CategoriesModule {}
