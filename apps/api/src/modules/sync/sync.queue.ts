import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SyncJobType } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { SyncJobPayload, SyncService } from './sync.service';

/**
 * İş kuyruğu. REDIS_URL tanımlıysa BullMQ ile arka planda çalışır (yeniden deneme, eşzamanlılık sınırı).
 * Tanımlı değilse (test / küçük kurulum) işler aynı süreçte, sırayla ve hemen çalışır.
 */
@Injectable()
export class SyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SyncQueue.name);
  private queue?: Queue;
  private worker?: Worker;
  private connection?: IORedis;
  readonly mode: 'redis' | 'inline';

  constructor(private sync: SyncService) {
    this.mode = process.env.REDIS_URL && process.env.SYNC_MODE !== 'inline' ? 'redis' : 'inline';
  }

  async onModuleInit() {
    if (this.mode !== 'redis') { this.log.warn('REDIS_URL yok: senkron işleri aynı süreçte çalışacak (inline).'); return; }
    this.connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    this.queue = new Queue('channel-sync', { connection: this.connection });
    this.worker = new Worker(
      'channel-sync',
      async (job) => {
        const { accountId, type, payload, idempotencyKey } = job.data as { accountId: string; type: SyncJobType; payload: SyncJobPayload; idempotencyKey?: string };
        const r = await this.sync.run(accountId, type, payload, idempotencyKey);
        if (r.status === 'FAILED') throw new Error(r.error ?? 'Senkron başarısız');
        return r.id;
      },
      { connection: this.connection, concurrency: 3 },
    );
    this.worker.on('failed', (job, err) => this.log.error(`İş başarısız ${job?.id}: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /** İşi kuyruğa ekler (veya inline modda hemen çalıştırır). */
  async enqueue(accountId: string, type: SyncJobType, payload: SyncJobPayload = {}, idempotencyKey?: string) {
    if (this.mode === 'redis' && this.queue) {
      const job = await this.queue.add(type, { accountId, type, payload, idempotencyKey }, {
        jobId: idempotencyKey, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 500, removeOnFail: 1000,
      });
      return { queued: true, jobId: job.id };
    }
    const r = await this.sync.run(accountId, type, payload, idempotencyKey);
    return { queued: false, jobId: r.id, status: r.status, error: r.error };
  }
}
