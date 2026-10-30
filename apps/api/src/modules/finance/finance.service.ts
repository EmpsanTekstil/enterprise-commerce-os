import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth/auth.service';

export interface Range { from: Date; to: Date }
const num = (v: unknown) => Number(v ?? 0);

/** Finans ve raporlar: tüm rakamlar gerçek tablolardan; demo veriler hariç tutulur. */
@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  private baseWhere(user: JwtPayload, r: Range) {
    return { organizationId: user.organizationId, isDemo: false, orderedAt: { gte: r.from, lte: r.to }, status: { notIn: ['CANCELLED', 'RETURNED'] as never[] } };
  }

  /** Günlük satış serisi (ciro, sipariş, komisyon). */
  async salesSeries(user: JwtPayload, r: Range) {
    const rows = await this.prisma.$queryRaw<{ day: Date; revenue: unknown; orders: bigint; commission: unknown }[]>`
      SELECT date_trunc('day', "orderedAt") AS day, SUM("grandTotal") AS revenue, COUNT(*)::bigint AS orders, SUM(COALESCE("commissionTotal",0)) AS commission
      FROM "Order" WHERE "organizationId" = ${user.organizationId} AND "isDemo" = false AND "orderedAt" BETWEEN ${r.from} AND ${r.to} AND status NOT IN ('CANCELLED','RETURNED')
      GROUP BY 1 ORDER BY 1`;
    return rows.map((x) => ({ day: x.day.toISOString().slice(0, 10), revenue: num(x.revenue), orders: Number(x.orders), commission: num(x.commission) }));
  }

  /** Kanal karşılaştırması: ciro, sipariş, iptal/iade oranı, komisyon, ortalama sepet. */
  async channels(user: JwtPayload, r: Range) {
    const rows = await this.prisma.$queryRaw<{ accountId: string; label: string; channel: string; revenue: unknown; orders: bigint; cancelled: bigint; returned: bigint; commission: unknown }[]>`
      SELECT ca.id AS "accountId", ca.label, sc.name AS channel,
        SUM(CASE WHEN o.status NOT IN ('CANCELLED','RETURNED') THEN o."grandTotal" ELSE 0 END) AS revenue,
        COUNT(*) FILTER (WHERE o.status NOT IN ('CANCELLED','RETURNED'))::bigint AS orders,
        COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::bigint AS cancelled,
        COUNT(*) FILTER (WHERE o.status = 'RETURNED')::bigint AS returned,
        SUM(CASE WHEN o.status NOT IN ('CANCELLED','RETURNED') THEN COALESCE(o."commissionTotal",0) ELSE 0 END) AS commission
      FROM "Order" o JOIN "ChannelAccount" ca ON ca.id = o."channelAccountId" JOIN "SalesChannel" sc ON sc.id = ca."channelId"
      WHERE o."organizationId" = ${user.organizationId} AND o."isDemo" = false AND o."orderedAt" BETWEEN ${r.from} AND ${r.to}
      GROUP BY ca.id, ca.label, sc.name ORDER BY revenue DESC`;
    return rows.map((x) => { const orders = Number(x.orders), total = orders + Number(x.cancelled) + Number(x.returned); return { ...x, revenue: num(x.revenue), orders, cancelled: Number(x.cancelled), returned: Number(x.returned), commission: num(x.commission), avgBasket: orders ? num(x.revenue) / orders : 0, returnRate: total ? (Number(x.returned) / total) * 100 : 0, cancelRate: total ? (Number(x.cancelled) / total) * 100 : 0 }; });
  }

  /** Ürün bazında satış ve kârlılık (maliyet varsa). */
  async products(user: JwtPayload, r: Range, limit = 200) {
    const rows = await this.prisma.$queryRaw<{ productId: string | null; name: string; sku: string | null; qty: bigint; revenue: unknown; commission: unknown; cost: unknown }[]>`
      SELECT p.id AS "productId", COALESCE(p.name, oi.name) AS name, pv.sku,
        SUM(oi.quantity)::bigint AS qty, SUM(oi."lineTotal") AS revenue, SUM(COALESCE(oi.commission,0)) AS commission, SUM(COALESCE(pv."costPrice",0) * oi.quantity) AS cost
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" LEFT JOIN "ProductVariant" pv ON pv.id = oi."variantId" LEFT JOIN "Product" p ON p.id = pv."productId"
      WHERE o."organizationId" = ${user.organizationId} AND o."isDemo" = false AND o."orderedAt" BETWEEN ${r.from} AND ${r.to} AND o.status NOT IN ('CANCELLED','RETURNED')
      GROUP BY p.id, COALESCE(p.name, oi.name), pv.sku ORDER BY revenue DESC LIMIT ${limit}`;
    return rows.map((x) => { const revenue = num(x.revenue), cost = num(x.cost), commission = num(x.commission); return { ...x, qty: Number(x.qty), revenue, commission, cost, grossProfit: revenue - commission - cost, hasCost: cost > 0 }; });
  }

  /** Stok devir hızı: dönem satış adedi / ortalama satılabilir stok (yaklaşık: güncel stok). */
  async stockTurnover(user: JwtPayload, r: Range) {
    const days = Math.max(1, (r.to.getTime() - r.from.getTime()) / 86_400_000);
    const rows = await this.prisma.$queryRaw<{ sku: string; name: string; sold: bigint; stock: bigint }[]>`
      SELECT pv.sku, p.name,
        COALESCE((SELECT SUM(oi.quantity) FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" WHERE oi."variantId" = pv.id AND o."isDemo" = false AND o."orderedAt" BETWEEN ${r.from} AND ${r.to} AND o.status NOT IN ('CANCELLED','RETURNED')),0)::bigint AS sold,
        COALESCE((SELECT SUM(ib."onHand" - ib.reserved) FROM "InventoryBalance" ib WHERE ib."variantId" = pv.id),0)::bigint AS stock
      FROM "ProductVariant" pv JOIN "Product" p ON p.id = pv."productId" WHERE p."organizationId" = ${user.organizationId} AND p."isDemo" = false AND p.status <> 'ARCHIVED'`;
    return rows.map((x) => { const sold = Number(x.sold), stock = Number(x.stock); const perDay = sold / days; return { sku: x.sku, name: x.name, sold, stock, dailyRate: perDay, daysOfCover: perDay > 0 ? Math.round(stock / perDay) : null, slow: sold === 0 && stock > 0 }; }).sort((a, b) => b.sold - a.sold);
  }

  async summary(user: JwtPayload, r: Range) {
    const [series, channels, products, ai, ads] = await Promise.all([
      this.salesSeries(user, r), this.channels(user, r), this.products(user, r, 20),
      this.prisma.aIRequest.aggregate({ where: { organizationId: user.organizationId, createdAt: { gte: r.from, lte: r.to } }, _sum: { costUsd: true } }),
      this.prisma.advertisingMetric.aggregate({ where: { campaign: { organizationId: user.organizationId }, date: { gte: r.from, lte: r.to } }, _sum: { spend: true, sales: true } }),
    ]);
    const revenue = series.reduce((s, d) => s + d.revenue, 0), commission = series.reduce((s, d) => s + d.commission, 0), orders = series.reduce((s, d) => s + d.orders, 0);
    const cost = products.reduce((s, p) => s + p.cost, 0);
    return { range: r, totals: { revenue, orders, commission, productCost: cost, adSpend: num(ads._sum.spend), adSales: num(ads._sum.sales), aiCostUsd: num(ai._sum.costUsd), grossProfit: revenue - commission - cost - num(ads._sum.spend), avgBasket: orders ? revenue / orders : 0 }, series, channels, topProducts: products.slice(0, 10), mostProfitable: [...products].filter((p) => p.hasCost).sort((a, b) => b.grossProfit - a.grossProfit).slice(0, 10), leastProfitable: [...products].filter((p) => p.hasCost).sort((a, b) => a.grossProfit - b.grossProfit).slice(0, 10) };
  }

  /** Excel dışa aktarma: birden fazla sayfa. */
  async exportXlsx(user: JwtPayload, r: Range): Promise<Buffer> {
    const [series, channels, products, turnover] = await Promise.all([this.salesSeries(user, r), this.channels(user, r), this.products(user, r, 5000), this.stockTurnover(user, r)]);
    const wb = XLSX.utils.book_new();
    const add = (name: string, rows: Record<string, unknown>[]) => { const ws = XLSX.utils.json_to_sheet(rows); XLSX.utils.book_append_sheet(wb, ws, name); };
    add('Günlük Satış', series.map((d) => ({ Tarih: d.day, Ciro: d.revenue, Sipariş: d.orders, Komisyon: d.commission })));
    add('Kanallar', channels.map((c) => ({ Kanal: c.channel, Hesap: c.label, Ciro: c.revenue, Sipariş: c.orders, 'Ort. Sepet': Math.round(c.avgBasket * 100) / 100, Komisyon: c.commission, İptal: c.cancelled, İade: c.returned, 'İade %': Math.round(c.returnRate * 10) / 10 })));
    add('Ürünler', products.map((p) => ({ Ürün: p.name, SKU: p.sku ?? '', Adet: p.qty, Ciro: p.revenue, Komisyon: p.commission, Maliyet: p.hasCost ? p.cost : '', 'Brüt Kâr': p.hasCost ? p.grossProfit : '' })));
    add('Stok Devir', turnover.map((t) => ({ SKU: t.sku, Ürün: t.name, 'Satılan Adet': t.sold, 'Mevcut Stok': t.stock, 'Günlük Satış': Math.round(t.dailyRate * 100) / 100, 'Kaç Günlük Stok': t.daysOfCover ?? '', 'Hareketsiz': t.slow ? 'Evet' : '' })));
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
}
