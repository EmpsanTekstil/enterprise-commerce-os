import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';
import { SyncQueue } from '../sync/sync.queue';
import { clampPrice, priceForMargin, profit } from './pricing.calc';

export interface RuleInput { name: string; channelAccountId?: string | null; commissionPercent: number; shippingCost: number; packagingCost: number; otherCostPercent: number; targetMarginPercent: number; minPrice?: number | null; maxPrice?: number | null; requireApproval?: boolean; isActive?: boolean }

@Injectable()
export class PricingService {
  constructor(private prisma: PrismaService, private audit: AuditService, private queue: SyncQueue) {}

  rules(user: JwtPayload) { return this.prisma.pricingRule.findMany({ where: { organizationId: user.organizationId }, include: { channelAccount: { select: { id: true, label: true, channel: { select: { name: true } } } } }, orderBy: { createdAt: 'asc' } }); }

  async saveRule(user: JwtPayload, data: RuleInput, id?: string) {
    if (data.minPrice != null && data.maxPrice != null && data.minPrice > data.maxPrice) throw new BadRequestException('Alt limit üst limitten büyük olamaz');
    const d = { ...data, channelAccountId: data.channelAccountId || null, requireApproval: data.requireApproval ?? true, isActive: data.isActive ?? true };
    const r = id ? await this.prisma.pricingRule.update({ where: { id }, data: d }) : await this.prisma.pricingRule.create({ data: { ...d, organizationId: user.organizationId } });
    await this.audit.log(user, id ? 'pricing.rule_update' : 'pricing.rule_create', 'PricingRule', r.id, null, data);
    return r;
  }

  async deleteRule(user: JwtPayload, id: string) { await this.prisma.pricingRule.deleteMany({ where: { id, organizationId: user.organizationId } }); return { ok: true }; }

  /** Kanal hesabı için geçerli kural: hesaba özel > genel. */
  private async ruleFor(organizationId: string, channelAccountId: string) {
    return (await this.prisma.pricingRule.findFirst({ where: { organizationId, channelAccountId, isActive: true } })) ?? (await this.prisma.pricingRule.findFirst({ where: { organizationId, channelAccountId: null, isActive: true } }));
  }

  /** Ürün bazında kanal kârlılığı (ilan fiyatı veya liste fiyatı üzerinden). */
  async productProfitability(user: JwtPayload, productId: string) {
    const p = await this.prisma.product.findFirst({ where: { id: productId, organizationId: user.organizationId }, include: { variants: { include: { listings: { include: { channelAccount: { select: { id: true, label: true, channel: { select: { name: true } } } } } } } } } });
    if (!p) throw new NotFoundException('Ürün bulunamadı');
    const rows = [];
    for (const v of p.variants) {
      const cost = v.costPrice != null ? Number(v.costPrice) : null;
      for (const l of v.listings) {
        const rule = await this.ruleFor(user.organizationId, l.channelAccountId);
        const price = l.salePrice != null ? Number(l.salePrice) : l.price != null ? Number(l.price) : v.listPrice != null ? Number(v.listPrice) : null;
        const inputs = rule && price != null && cost != null ? { salePrice: price, vatRate: Number(p.vatRate), costPrice: cost, commissionPercent: Number(rule.commissionPercent), shippingCost: Number(rule.shippingCost), packagingCost: Number(rule.packagingCost), otherCostPercent: Number(rule.otherCostPercent) } : null;
        const suggested = rule && cost != null ? priceForMargin({ vatRate: Number(p.vatRate), costPrice: cost, commissionPercent: Number(rule.commissionPercent), shippingCost: Number(rule.shippingCost), packagingCost: Number(rule.packagingCost), otherCostPercent: Number(rule.otherCostPercent), targetMarginPercent: Number(rule.targetMarginPercent) }) : null;
        rows.push({ sku: v.sku, variantId: v.id, listingId: l.id, channel: `${l.channelAccount.channel.name} · ${l.channelAccount.label}`, price, cost, rule: rule ? { id: rule.id, name: rule.name, targetMarginPercent: Number(rule.targetMarginPercent) } : null, breakdown: inputs ? profit(inputs) : null, suggestedPrice: suggested != null ? clampPrice(suggested, rule?.minPrice != null ? Number(rule.minPrice) : null, rule?.maxPrice != null ? Number(rule.maxPrice) : null) : null, missing: [cost == null && 'Alış maliyeti', price == null && 'Satış fiyatı', !rule && 'Fiyat kuralı'].filter(Boolean) });
      }
    }
    return { productId, name: p.name, vatRate: Number(p.vatRate), rows };
  }

  /** Tüm aktif ilanlar için hedef marj fiyatı hesaplar; farklı olanları ÖNERİ olarak kaydeder (uygulamaz). */
  async generateProposals(user: JwtPayload, channelAccountId?: string, minDiffPercent = 1) {
    const listings = await this.prisma.listing.findMany({ where: { channelAccount: { organizationId: user.organizationId, id: channelAccountId }, variantId: { not: null }, status: { in: ['ACTIVE', 'PAUSED'] } }, include: { variant: { include: { product: true } } } });
    let created = 0, skipped = 0;
    for (const l of listings) {
      const rule = await this.ruleFor(user.organizationId, l.channelAccountId);
      const v = l.variant!; const cost = v.costPrice != null ? Number(v.costPrice) : null;
      if (!rule || cost == null) { skipped++; continue; }
      const base = { vatRate: Number(v.product.vatRate), costPrice: cost, commissionPercent: Number(rule.commissionPercent), shippingCost: Number(rule.shippingCost), packagingCost: Number(rule.packagingCost), otherCostPercent: Number(rule.otherCostPercent) };
      const target = priceForMargin({ ...base, targetMarginPercent: Number(rule.targetMarginPercent) });
      if (target == null) { skipped++; continue; }
      const { price: proposed, clamped } = clampPrice(target, rule.minPrice != null ? Number(rule.minPrice) : null, rule.maxPrice != null ? Number(rule.maxPrice) : null);
      const current = l.salePrice != null ? Number(l.salePrice) : l.price != null ? Number(l.price) : v.listPrice != null ? Number(v.listPrice) : null;
      if (current != null && Math.abs(proposed - current) / current * 100 < minDiffPercent) { skipped++; continue; }
      const open = await this.prisma.priceProposal.findFirst({ where: { listingId: l.id, status: 'PENDING' } });
      if (open) { skipped++; continue; }
      const reason = `Hedef marj %${Number(rule.targetMarginPercent)} (${rule.name})${clamped ? clamped === 'min' ? ' — alt limite kırpıldı' : ' — üst limite kırpıldı' : ''}`;
      await this.prisma.priceProposal.create({ data: { organizationId: user.organizationId, channelAccountId: l.channelAccountId, listingId: l.id, ruleId: rule.id, currentPrice: current, proposedPrice: proposed, reason, breakdownJson: profit({ ...base, salePrice: proposed }) as unknown as Prisma.InputJsonValue } });
      created++;
    }
    await this.audit.log(user, 'pricing.proposals', 'PriceProposal', undefined, null, { created, skipped });
    return { created, skipped };
  }

  proposals(user: JwtPayload, status = 'PENDING') {
    return this.prisma.$queryRaw<unknown[]>`
      SELECT pp.*, l."externalSku" AS sku, l.title, ca.label AS "accountLabel", sc.name AS "channelName", pv.sku AS "variantSku", p.name AS "productName"
      FROM "PriceProposal" pp JOIN "Listing" l ON l.id = pp."listingId" JOIN "ChannelAccount" ca ON ca.id = pp."channelAccountId" JOIN "SalesChannel" sc ON sc.id = ca."channelId"
      LEFT JOIN "ProductVariant" pv ON pv.id = l."variantId" LEFT JOIN "Product" p ON p.id = pv."productId"
      WHERE pp."organizationId" = ${user.organizationId} AND pp.status = ${status}::"ProposalStatus" ORDER BY pp."createdAt" DESC LIMIT 500`;
  }

  /** Onay: ilan fiyatı güncellenir ve kanala PRICE_PUSH kuyruğa alınır. Ret: yalnızca işaretlenir. */
  async decide(user: JwtPayload, ids: string[], approve: boolean) {
    let applied = 0, rejected = 0; const errors: string[] = [];
    for (const id of ids) {
      const pr = await this.prisma.priceProposal.findFirst({ where: { id, organizationId: user.organizationId, status: 'PENDING' } });
      if (!pr) continue;
      if (!approve) { await this.prisma.priceProposal.update({ where: { id }, data: { status: 'REJECTED', decidedById: user.sub, decidedAt: new Date() } }); rejected++; continue; }
      try {
        const l = await this.prisma.listing.update({ where: { id: pr.listingId }, data: { price: pr.proposedPrice, salePrice: pr.proposedPrice } });
        await this.prisma.priceProposal.update({ where: { id }, data: { status: 'APPLIED', decidedById: user.sub, decidedAt: new Date() } });
        await this.queue.enqueue(pr.channelAccountId, 'PRICE_PUSH', { variantIds: [l.variantId!] }, `price-push:${l.id}:${Date.now()}`);
        applied++;
      } catch (e) { await this.prisma.priceProposal.update({ where: { id }, data: { status: 'FAILED', error: (e as Error).message } }); errors.push((e as Error).message); }
    }
    await this.audit.log(user, approve ? 'pricing.approve' : 'pricing.reject', 'PriceProposal', undefined, null, { ids, applied, rejected });
    return { applied, rejected, errors };
  }
}
