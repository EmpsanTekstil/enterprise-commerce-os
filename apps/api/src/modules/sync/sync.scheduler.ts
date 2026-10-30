import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncQueue } from './sync.queue';

/**
 * Periyodik senkron: bağlı tüm hesaplar için siparişleri her 5 dakikada bir çeker.
 * SYNC_SCHEDULER=off ile kapatılır (testlerde kapalıdır).
 */
@Injectable()
export class SyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SyncScheduler.name);
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService, private queue: SyncQueue) {}

  onModuleInit() {
    if (process.env.SYNC_SCHEDULER === 'off' || process.env.NODE_ENV === 'test') return;
    const minutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 5);
    this.timer = setInterval(() => this.tick().catch((e) => this.log.error(e)), minutes * 60_000);
    this.log.log(`Zamanlayıcı açık: her ${minutes} dk sipariş senkronu`);
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick() {
    const accounts = await this.prisma.channelAccount.findMany({ where: { status: 'CONNECTED' } });
    const bucket = Math.floor(Date.now() / 300_000); // 5 dk'lık pencere → aynı pencerede tek iş
    for (const a of accounts) {
      await this.queue.enqueue(a.id, 'ORDER_PULL', {}, `order-pull:${a.id}:${bucket}`);
      if (Math.floor(Date.now() / 900_000) !== Math.floor((Date.now() - 300_000) / 900_000)) await this.queue.enqueue(a.id, 'RETURN_PULL', {}, `return-pull:${a.id}:${Math.floor(Date.now() / 900_000)}`); // 15 dk'da bir
      if (Math.floor(Date.now() / 900_000) !== Math.floor((Date.now() - 300_000) / 900_000)) await this.queue.enqueue(a.id, 'QUESTION_PULL', {}, `question-pull:${a.id}:${Math.floor(Date.now() / 900_000)}`);
      const pending = await this.prisma.listing.count({ where: { channelAccountId: a.id, status: 'PENDING', batchRequestId: { not: null } } });
      if (pending) await this.queue.enqueue(a.id, 'BATCH_CHECK', {}, `batch-check:${a.id}:${bucket}`);
    }
  }
}
