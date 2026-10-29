import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SyncJobType } from '@prisma/client';
import { AdapterRegistry } from '../../integrations/adapter.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelsService } from '../channels/channels.service';
import { ListingsService } from '../listings/listings.service';
import { PublishService } from '../listings/publish.service';
import { OrdersService } from '../orders/orders.service';
import { ReturnsService } from '../returns/returns.service';

export interface SyncJobPayload { variantIds?: string[]; since?: string }

/**
 * Senkronizasyon işlerini çalıştırır ve her çalışmayı ListingSyncJob tablosuna kaydeder.
 * Başarısız işler gizlenmez: hata metni iş kaydına ve kanal hesabına (lastError) yazılır.
 */
@Injectable()
export class SyncService {
  private readonly log = new Logger(SyncService.name);

  constructor(
    private prisma: PrismaService,
    private registry: AdapterRegistry,
    private channels: ChannelsService,
    private listings: ListingsService,
    private publish: PublishService,
    private orders: OrdersService,
    private returns: ReturnsService,
  ) {}

  async run(accountId: string, type: SyncJobType, payload: SyncJobPayload = {}, idempotencyKey?: string) {
    if (idempotencyKey) {
      const dup = await this.prisma.listingSyncJob.findUnique({ where: { idempotencyKey } });
      if (dup && dup.status !== 'FAILED') return dup; // aynı iş ikinci kez çalışmaz
    }
    const account = await this.prisma.channelAccount.findUniqueOrThrow({ where: { id: accountId }, include: { channel: true } });
    const job = await this.prisma.listingSyncJob.create({
      data: { channelAccountId: accountId, type, status: 'RUNNING', payload: payload as Prisma.InputJsonValue, idempotencyKey, startedAt: new Date(), attempts: 1 },
    });
    try {
      const adapter = this.registry.get(account.channel.code);
      const ctx = this.channels.buildContext(account);
      let result: unknown;
      switch (type) {
        case 'CATEGORY_PULL': result = await this.listings.pullCategories(account, adapter, ctx); break;
        case 'PRODUCT_PULL': result = await this.listings.pullProducts(account, adapter, ctx); break;
        case 'ORDER_PULL': result = await this.orders.pullOrders(account, adapter, ctx, payload.since ? new Date(payload.since) : undefined); break;
        case 'RETURN_PULL': result = await this.returns.pullReturns(account, adapter, ctx, payload.since ? new Date(payload.since) : undefined); break;
        case 'BATCH_CHECK': result = await this.publish.checkBatches(account, adapter, ctx); break;
        case 'STOCK_PUSH':
        case 'PRICE_PUSH': result = await this.listings.pushStockAndPrice(account, adapter, ctx, payload.variantIds); break;
        default: throw new Error(`Bu iş türü henüz uygulanmadı: ${type}`);
      }
      await this.prisma.channelAccount.update({ where: { id: accountId }, data: { lastSyncAt: new Date(), lastError: null, status: 'CONNECTED' } });
      return this.prisma.listingSyncJob.update({ where: { id: job.id }, data: { status: 'SUCCESS', result: result as Prisma.InputJsonValue, finishedAt: new Date() } });
    } catch (e) {
      const message = (e as Error).message;
      this.log.error(`Senkron hatası [${account.channel.code}/${account.label}] ${type}: ${message}`);
      await this.prisma.channelAccount.update({ where: { id: accountId }, data: { lastError: `${type}: ${message}`, status: 'ERROR' } });
      return this.prisma.listingSyncJob.update({ where: { id: job.id }, data: { status: 'FAILED', error: message, finishedAt: new Date() } });
    }
  }

  listJobs(organizationId: string, accountId?: string, take = 50) {
    return this.prisma.listingSyncJob.findMany({
      where: { channelAccount: { organizationId, id: accountId } },
      include: { channelAccount: { select: { label: true, channel: { select: { code: true, name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
