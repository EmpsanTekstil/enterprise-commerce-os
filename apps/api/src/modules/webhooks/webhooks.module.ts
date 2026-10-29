import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { WebhooksController } from './webhooks.controller';

@Module({ imports: [OrdersModule], controllers: [WebhooksController] })
export class WebhooksModule {}
