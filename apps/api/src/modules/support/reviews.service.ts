import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChannelAccount, Prisma, Sentiment } from '@prisma/client';
import { AdapterContext, ChannelAdapter, UnsupportedOperationError } from '../../integrations/adapter.interface';
import { AdapterRegistry } from '../../integrations/adapter.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { REVIEW_ANALYZE_SYSTEM, REVIEW_REPLY_SYSTEM } from '../ai/ai.prompts';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';
import { ChannelsService } from '../channels/channels.service';
import { parseSheet } from '../bulk/bulk.parser';

type Account = ChannelAccount & { channel: { code: string } };

/** Yorum Excel içe aktarma sütunları (pazaryeri panelinden indirilen rapor için). */
export const REVIEW_COLUMNS = [
  { key: 'yorum_id', title: 'Yorum ID *', required: true },
  { key: 'barkod', title: 'Barkod', required: false },
  { key: 'sku', title: 'SKU', required: false },
  { key: 'puan', title: 'Puan *', required: true, type: 'int' as const },
  { key: 'baslik', title: 'Başlık', required: false },
  { key: 'yorum', title: 'Yorum', required: false },
  { key: 'musteri', title: 'Müşteri', required: false },
  { key: 'tarih', title: 'Tarih', required: false, hint: 'GG.AA.YYYY veya YYYY-AA-GG' },
];

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private channels: ChannelsService, private registry: AdapterRegistry, private ai: AiService) {}

  /** API destekleyen kanallardan çekme (bugün hiçbir TR pazaryeri sunmuyor; arayüz gelecek için hazır). */
  async pullReviews(account: Account, adapter: ChannelAdapter, ctx: AdapterContext, since?: Date) {
    if (!adapter.fetchReviews) throw new UnsupportedOperationError(adapter.displayName, 'reviews.read');
    let cursor: string | undefined; let created = 0, pages = 0;
    do {
      const page = await adapter.fetchReviews(ctx, since ?? new Date(Date.now() - 30 * 86_400_000), cursor); pages++;
      for (const r of page.items) {
        const productId = await this.resolveProduct(account.organizationId, account.id, r.productExternalId);
        const res = await this.prisma.productReview.upsert({
          where: { channelAccountId_externalId: { channelAccountId: account.id, externalId: r.externalId } },
          update: { rating: r.rating, title: r.title, text: r.text, customerName: r.customerName, productId },
          create: { organizationId: account.organizationId, channelAccountId: account.id, externalId: r.externalId, rating: r.rating, title: r.title, text: r.text, customerName: r.customerName, productId, reviewedAt: r.reviewedAt, canReplyViaApi: !!adapter.replyReview, rawSnapshot: r.raw as Prisma.InputJsonValue },
        });
        if (res.createdAt.getTime() > Date.now() - 5000) created++;
      }
      cursor = page.nextCursor;
    } while (cursor && pages < 50);
    return { created, pages };
  }

  /** Pazaryeri panelinden indirilen yorum raporunu (Excel/CSV) içe aktarır. */
  async importSheet(user: JwtPayload, accountId: string, buffer: Buffer) {
    const account = await this.channels.getOwned(user, accountId);
    const { rows } = parseSheet(buffer, REVIEW_COLUMNS);
    let created = 0, updated = 0; const errors: { row: number; error: string }[] = [];
    for (const r of rows) {
      if (r.errors.length) { errors.push({ row: r.row, error: r.errors.join('; ') }); continue; }
      const rating = Number(r.data.puan); if (rating < 1 || rating > 5) { errors.push({ row: r.row, error: 'Puan 1-5 olmalı' }); continue; }
      const productId = await this.resolveProduct(user.organizationId, accountId, (r.data.barkod ?? r.data.sku) as string | undefined);
      const reviewedAt = parseTrDate(r.data.tarih as string | undefined) ?? new Date();
      const ex = await this.prisma.productReview.findUnique({ where: { channelAccountId_externalId: { channelAccountId: accountId, externalId: String(r.data.yorum_id) } } });
      const data = { rating, title: str(r.data.baslik), text: str(r.data.yorum), customerName: str(r.data.musteri), productId };
      if (ex) { await this.prisma.productReview.update({ where: { id: ex.id }, data }); updated++; }
      else { await this.prisma.productReview.create({ data: { ...data, organizationId: user.organizationId, channelAccountId: accountId, externalId: String(r.data.yorum_id), reviewedAt, canReplyViaApi: false, rawSnapshot: r.data as Prisma.InputJsonValue } }); created++; }
    }
    await this.audit.log(user, 'reviews.import', 'ChannelAccount', accountId, null, { created, updated, errors: errors.length, channel: account.channel.code });
    return { total: rows.length, created, updated, errors };
  }

  private async resolveProduct(organizationId: string, accountId: string, key?: string) {
    if (!key) return undefined;
    const l = await this.prisma.listing.findFirst({ where: { channelAccountId: accountId, OR: [{ externalId: key }, { externalSku: key }], variantId: { not: null } }, include: { variant: { select: { productId: true } } } });
    if (l?.variant) return l.variant.productId;
    const v = await this.prisma.productVariant.findFirst({ where: { OR: [{ barcode: key }, { sku: key }], product: { organizationId } }, select: { productId: true } });
    return v?.productId;
  }

  async list(user: JwtPayload, q: { accountId?: string; productId?: string; sentiment?: string; minRating?: number; maxRating?: number; page: number; pageSize: number }) {
    const where: Prisma.ProductReviewWhereInput = { organizationId: user.organizationId, channelAccountId: q.accountId, productId: q.productId, sentiment: q.sentiment as Sentiment | undefined, rating: { gte: q.minRating, lte: q.maxRating } };
    const [items, total, agg] = await this.prisma.$transaction([
      this.prisma.productReview.findMany({ where, include: { product: { select: { id: true, name: true } }, channelAccount: { select: { label: true, channel: { select: { name: true } } } }, responses: { orderBy: { createdAt: 'desc' } } }, orderBy: { reviewedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.productReview.count({ where }),
      this.prisma.productReview.aggregate({ where: { organizationId: user.organizationId }, _avg: { rating: true }, _count: { _all: true } }),
    ]);
    const dist = await this.prisma.$queryRaw<{ rating: number; count: bigint }[]>`SELECT rating, COUNT(*)::bigint AS count FROM "ProductReview" WHERE "organizationId" = ${user.organizationId} GROUP BY rating`;
    return { items, total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize), summary: { average: Number(agg._avg.rating ?? 0), count: agg._count._all, distribution: Object.fromEntries(dist.map((d) => [d.rating, Number(d.count)])) } };
  }

  /** Puana göre anında sınıflandırma (AI olmadan). */
  async classifyByRating(user: JwtPayload) {
    const r = await this.prisma.productReview.updateMany({ where: { organizationId: user.organizationId, sentiment: 'UNKNOWN' }, data: {} });
    await this.prisma.$executeRaw`UPDATE "ProductReview" SET sentiment = CASE WHEN rating >= 4 THEN 'POSITIVE'::"Sentiment" WHEN rating = 3 THEN 'NEUTRAL'::"Sentiment" ELSE 'NEGATIVE'::"Sentiment" END WHERE "organizationId" = ${user.organizationId} AND sentiment = 'UNKNOWN'`;
    return { updated: r.count };
  }

  /** AI ile sınıflandırma: duygu + kategori + şikâyet; en fazla `limit` yorum. */
  async analyze(user: JwtPayload, limit = 20) {
    const reviews = await this.prisma.productReview.findMany({ where: { organizationId: user.organizationId, aiCategory: null, text: { not: null } }, orderBy: { reviewedAt: 'desc' }, take: Math.min(limit, 50) });
    let done = 0, cost = 0;
    for (const r of reviews) {
      const res = await this.ai.complete(user, user.organizationId, 'review_analyze', REVIEW_ANALYZE_SYSTEM, `Puan: ${r.rating}/5\nBaşlık: ${r.title ?? ''}\nYorum: ${r.text}`, 200);
      cost += res.costUsd;
      try {
        const j = JSON.parse(res.text.replace(/^```json|```$/g, '').trim()) as { sentiment: Sentiment; category: string; isComplaint: boolean; summary: string };
        await this.prisma.productReview.update({ where: { id: r.id }, data: { sentiment: j.sentiment, aiCategory: `${j.category}${j.isComplaint ? ' (şikâyet)' : ''}: ${j.summary}` } });
        done++;
      } catch { /* geçersiz JSON: yorum atlanır, bir sonraki çalıştırmada tekrar denenir */ }
    }
    return { analyzed: done, remaining: await this.prisma.productReview.count({ where: { organizationId: user.organizationId, aiCategory: null, text: { not: null } } }), costUsd: cost };
  }

  /** Tekrarlayan sorunlar: ürün bazında olumsuz yorum kategorileri. */
  async insights(user: JwtPayload) {
    const rows = await this.prisma.productReview.findMany({ where: { organizationId: user.organizationId, sentiment: 'NEGATIVE' }, select: { productId: true, aiCategory: true, product: { select: { name: true } } } });
    const map = new Map<string, { product: string; count: number; categories: Record<string, number> }>();
    for (const r of rows) {
      const key = r.productId ?? '—'; const e = map.get(key) ?? { product: r.product?.name ?? 'Eşleşmeyen ürün', count: 0, categories: {} };
      e.count++; const cat = (r.aiCategory ?? 'sınıflandırılmadı').split(':')[0].replace(' (şikâyet)', ''); e.categories[cat] = (e.categories[cat] ?? 0) + 1; map.set(key, e);
    }
    return [...map.entries()].map(([productId, v]) => ({ productId, ...v })).sort((a, b) => b.count - a.count).slice(0, 50);
  }

  async aiReplyDraft(user: JwtPayload, reviewId: string) {
    const r = await this.prisma.productReview.findFirst({ where: { id: reviewId, organizationId: user.organizationId }, include: { product: true } });
    if (!r) throw new NotFoundException('Yorum bulunamadı');
    const res = await this.ai.complete(user, user.organizationId, 'review_reply', REVIEW_REPLY_SYSTEM, `Ürün: ${r.product?.name ?? 'bilinmiyor'}\nPuan: ${r.rating}/5\nYorum: ${r.title ?? ''} ${r.text ?? ''}`, 300);
    const d = await this.prisma.reviewResponse.create({ data: { reviewId, authorId: user.sub, source: 'AI_DRAFT', text: res.text } });
    return { draft: d, costUsd: res.costUsd };
  }

  async draft(user: JwtPayload, reviewId: string, text: string) {
    const r = await this.prisma.productReview.findFirst({ where: { id: reviewId, organizationId: user.organizationId } });
    if (!r) throw new NotFoundException('Yorum bulunamadı');
    return this.prisma.reviewResponse.create({ data: { reviewId, authorId: user.sub, source: 'HUMAN', text } });
  }

  /** Gönderim: API yoksa yalnızca "panelden gönderildi" işareti. */
  async send(user: JwtPayload, reviewId: string, responseId: string, markOnly: boolean) {
    const r = await this.prisma.productReview.findFirst({ where: { id: reviewId, organizationId: user.organizationId }, include: { channelAccount: { include: { channel: true } } } });
    const resp = await this.prisma.reviewResponse.findFirst({ where: { id: responseId, reviewId } });
    if (!r || !resp) throw new NotFoundException('Yorum veya cevap bulunamadı');
    if (resp.sentAt) throw new BadRequestException('Zaten gönderilmiş');
    if (!markOnly) {
      const adapter = this.registry.get(r.channelAccount.channel.code);
      if (!adapter.replyReview) throw new UnsupportedOperationError(adapter.displayName, 'reviews.reply');
      const x = await adapter.replyReview(this.channels.buildContext(r.channelAccount), r.externalId, resp.text);
      if (!x.ok) throw new BadRequestException(`Kanal cevabı kabul etmedi: ${x.error}`);
    }
    await this.prisma.reviewResponse.update({ where: { id: responseId }, data: { isApproved: true, sentAt: new Date() } });
    await this.audit.log(user, markOnly ? 'review.mark_replied' : 'review.reply', 'ProductReview', reviewId, null, { responseId });
    return { ok: true };
  }
}

const str = (v: unknown) => (v == null || v === '' ? undefined : String(v));
function parseTrDate(v?: string) {
  if (!v) return undefined;
  const m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/); if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d;
}
