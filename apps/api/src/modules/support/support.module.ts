import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';

@Module({ imports: [ChannelsModule], controllers: [QuestionsController], providers: [QuestionsService], exports: [QuestionsService] })
export class SupportModule {}
