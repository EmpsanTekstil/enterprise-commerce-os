import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({ imports: [ChannelsModule], controllers: [QuestionsController, ReviewsController], providers: [QuestionsService, ReviewsService], exports: [QuestionsService, ReviewsService] })
export class SupportModule {}
