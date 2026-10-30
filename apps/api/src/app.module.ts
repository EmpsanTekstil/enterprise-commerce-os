import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { PermissionsGuard } from './modules/auth/permissions.guard';
import { HealthModule } from './modules/health/health.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { ProductsModule } from './modules/products/products.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AuditModule } from './modules/audit/audit.module';
import { ListingsModule } from './modules/listings/listings.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SyncModule } from './modules/sync/sync.module';
import { MediaModule } from './modules/media/media.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { BulkModule } from './modules/bulk/bulk.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { AiModule } from './modules/ai/ai.module';
import { SupportModule } from './modules/support/support.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { FinanceModule } from './modules/finance/finance.module';
import { AutomationModule } from './modules/automation/automation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Rate limiting: dakikada 300 istek / IP
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
    IntegrationsModule,
    ChannelsModule,
    ProductsModule,
    DashboardModule,
    ListingsModule,
    OrdersModule,
    SyncModule,
    MediaModule,
    CategoriesModule,
    BulkModule,
    ReturnsModule,
    WebhooksModule,
    InventoryModule,
    AiModule,
    SupportModule,
    PricingModule,
    FinanceModule,
    AutomationModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
