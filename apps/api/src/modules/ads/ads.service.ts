import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CampaignStatus, ChannelAccount, Prisma } from '@prisma/client';
import { AdapterContext, ChannelAdapter, UnsupportedOperationError } from '../../integrations/adapter.interface';
import { AdapterRegistry } from '../../integrations/adapter.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';
import { parseSheet } from '../bulk/bulk.parser';
import { ChannelsService } from '../channels/channels.service';

type Account = ChannelAccount & { channel: { code: string } };

/** Pazaryeri panelinden indirilen reklam raporu için sütunlar (günlük, kampanya bazında). */
export const AD_COLUMNS = [
  { key: 'tarih', title: 'Tarih *', required: true, hint: 'GG.AA.YYYY veya YYYY-AA-GG' },
  { key: 'kampanya', title: 'Kampanya *', required: true, hint: 'Kampanya adı veya kimliği' },
  { key: 'barkod', title: 'Barkod', required: false, hint: 'Ürün bazında rapor ise' },
  { key: 'gosterim', title: 'Gösterim', required: false, type: 'int' as const },
  { key: 'tiklama', title: 'Tıklama', required: false, type: 'int' as const },
  { key: 'harcama', title: 'Harcama *', required: true, type: 'money' as const },
  { key: 'siparis', title: 'Sipariş', required: false, type: 'int' as const },
  { key: 'satis', title: 'Satış Tutarı', required: false, type: 'money' as const },
  { key: 'gunluk_butce', title: 'Günlük Bütçe', required: false, type: 'money' as const },
];

const kpi = (m: { impressions: number; clicks: number; spend: number; orders: number; sales: number }) => ({
  ...m, ctr: m.impressions ? (m.clicks / m.impressions) * 100 : 0, cpc: m.clicks ? m.spend / m.clicks : 0, roas: m.spend ? m.sales / m.spend : 0, acos: m.sales ? (m.spend / m.sales) * 100 : null, conversion: m.clicks ? (m.orders / m.clicks) * 100 : 0,
});

@Injectable()
export class AdsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private channels: ChannelsService, private registry: AdapterRegistry) {}

  /** API destekleyen kanaldan kampanya + metrik çeker (senkron işi ADS_PULL). */
  async pullAds(account: Account, adapter: ChannelAdapter, ctx: AdapterContext, days = 14) {
    if (!adapter.fetchCampaigns || !adapter.fetchAdMetrics) throw new UnsupportedOperationError(adapter.displayName, 'ads.reports');
    const campaigns = await adapter.fetchCampaigns(ctx);
    for (const c of campaigns) {
      const status = mapCampaignStatus(c.status);
      await this.prisma.advertisingCampaign.upsert({
        where: { channelAccountId_externalId: { channelAccountId: account.id, externalId: c.externalId } },
        update: { name: c.name, type: c.type, status, dailyBudget: c.dailyBudget, totalBudget: c.totalBudget, startDate: c.startDate, endDate: c.endDate, isManagedViaApi: !!adapter.updateCampaign, source: 'API', rawSnapshot: c.raw as Prisma.InputJsonValue, lastSyncedAt: new Date() },
        create: { organizationId: account.organizationId, channelAccountId: account.id, externalId: c.externalId, name: c.name, type: c.type, status, dailyBudget: c.dailyBudget, totalBudget: c.totalBudget, startDate: c.startDate, endDate: c.endDate, isManagedViaApi: !!adapter.updateCampaign, source: 'API', rawSnapshot: c.raw as Prisma.InputJsonValue, lastSyncedAt: new Date() },
      });
    }
    const to = new Date(); const from = new Date(Date.now() - days * 86_400_000);
    const metrics = await adapter.fetchAdMetrics(ctx, from, to);
    let saved = 0;
    for (const m of metrics) saved += await this.saveMetric(account, m.campaignExternalId, m.date, m, m.productExternalId);
    return { campaigns: campaigns.length, metrics: saved };
  }

  private async saveMetric(account: Account, campaignExternalId: string, date: Date, m: { impressions: number; clicks: number; spend: number; orders: number; sales: number }, productExternalId?: string) {
    const c = await this.prisma.advertisingCampaign.findUnique({ where: { channelAccountId_externalId: { channelAccountId: account.id, externalId: campaignExternalId } } });
    if (!c) return 0;
    let variantId: string | null = null;
    if (productExternalId) {
      const l = await this.prisma.listing.findFirst({ where: { channelAccountId: account.id, OR: [{ externalId: productExternalId }, { externalSku: productExternalId }], variantId: { not: null } } });
      variantId = l?.variantId ?? (await this.prisma.productVariant.findFirst({ where: { OR: [{ barcode: productExternalId }, { sku: productExternalId }], product: { organizationId: account.organizationId } } }))?.id ?? null;
    }
    const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const where = { campaignId: c.id, variantId, date: day };
    const ex = await this.prisma.advertisingMetric.findFirst({ where });
    if (ex) await this.prisma.advertisingMetric.update({ where: { id: ex.id }, data: m });
    else await this.prisma.advertisingMetric.create({ data: { ...where, ...m } });
    return 1;
  }

  /** Excel içe aktarma (API olmayan kanallar): kampanya adı ile kampanya oluşturulur/bulunur, günlük metrik yazılır. */
  async importSheet(user: JwtPayload, accountId: string, buffer: Buffer) {
    const account = await this.channels.getOwned(user, accountId);
    const { rows } = parseSheet(buffer, AD_COLUMNS);
    let saved = 0; const errors: { row: number; error: string }[] = [];
    for (const r of rows) {
      if (r.errors.length) { errors.push({ row: r.row, error: r.errors.join('; ') }); continue; }
      const date = parseDate(String(r.data.tarih)); if (!date) { errors.push({ row: r.row, error: 'Tarih okunamadı' }); continue; }
      const name = String(r.data.kampanya).trim(); const externalId = `import:${name.toLowerCase()}`;
      await this.prisma.advertisingCampaign.upsert({
        where: { channelAccountId_externalId: { channelAccountId: accountId, externalId } },
        update: { name, dailyBudget: r.data.gunluk_butce != null && r.data.gunluk_butce !== '' ? Number(r.data.gunluk_butce) : undefined, lastSyncedAt: new Date() },
        create: { organizationId: user.organizationId, channelAccountId: accountId, externalId, name, type: 'import', status: 'UNKNOWN', dailyBudget: r.data.gunluk_butce != null && r.data.gunluk_butce !== '' ? Number(r.data.gunluk_butce) : undefined, isManagedViaApi: false, source: 'IMPORT', lastSyncedAt: new Date() },
      });
      saved += await this.saveMetric(account, externalId, date, { impressions: Number(r.data.gosterim ?? 0), clicks: Number(r.data.tiklama ?? 0), spend: Number(r.data.harcama ?? 0), orders: Number(r.data.siparis ?? 0), sales: Number(r.data.satis ?? 0) }, r.data.barkod ? String(r.data.barkod) : undefined);
    }
    await this.audit.log(user, 'ads.import', 'ChannelAccount', accountId, null, { rows: rows.length, saved, errors: errors.length });
    return { total: rows.length, saved, errors };
  }

  async dashboard(user: JwtPayload, from: Date, to: Date) {
    const where = { campaign: { organizationId: user.organizationId }, date: { gte: from, lte: to } };
    const [byCampaign, series, byProduct, byChannel] = await Promise.all([
      this.prisma.advertisingMetric.groupBy({ by: ['campaignId'], where, _sum: { impressions: true, clicks: true, spend: true, orders: true, sales: true } }),
      this.prisma.$queryRaw<{ day: Date; spend: unknown; sales: unknown; orders: bigint }[]>`SELECT m.date AS day, SUM(m.spend) AS spend, SUM(m.sales) AS sales, SUM(m.orders)::bigint AS orders FROM "AdvertisingMetric" m JOIN "AdvertisingCampaign" c ON c.id = m."campaignId" WHERE c."organizationId" = ${user.organizationId} AND m.date BETWEEN ${from} AND ${to} GROUP BY m.date ORDER BY m.date`,
      this.prisma.$queryRaw<{ variantId: string; sku: string; name: string; impressions: bigint; clicks: bigint; spend: unknown; orders: bigint; sales: unknown }[]>`SELECT pv.id AS "variantId", pv.sku, p.name, SUM(m.impressions)::bigint AS impressions, SUM(m.clicks)::bigint AS clicks, SUM(m.spend) AS spend, SUM(m.orders)::bigint AS orders, SUM(m.sales) AS sales FROM "AdvertisingMetric" m JOIN "AdvertisingCampaign" c ON c.id = m."campaignId" JOIN "ProductVariant" pv ON pv.id = m."variantId" JOIN "Product" p ON p.id = pv."productId" WHERE c."organizationId" = ${user.organizationId} AND m.date BETWEEN ${from} AND ${to} GROUP BY pv.id, pv.sku, p.name ORDER BY spend DESC LIMIT 100`,
      this.prisma.$queryRaw<{ accountId: string; label: string; channel: string; spend: unknown; sales: unknown; orders: bigint; clicks: bigint; impressions: bigint }[]>`SELECT ca.id AS "accountId", ca.label, sc.name AS channel, SUM(m.spend) AS spend, SUM(m.sales) AS sales, SUM(m.orders)::bigint AS orders, SUM(m.clicks)::bigint AS clicks, SUM(m.impressions)::bigint AS impressions FROM "AdvertisingMetric" m JOIN "AdvertisingCampaign" c ON c.id = m."campaignId" JOIN "ChannelAccount" ca ON ca.id = c."channelAccountId" JOIN "SalesChannel" sc ON sc.id = ca."channelId" WHERE c."organizationId" = ${user.organizationId} AND m.date BETWEEN ${from} AND ${to} GROUP BY ca.id, ca.label, sc.name ORDER BY spend DESC`,
    ]);
    const campaigns = await this.prisma.advertisingCampaign.findMany({ where: { organizationId: user.organizationId }, include: { channelAccount: { select: { id: true, label: true, channel: { select: { code: true, name: true } } } } } });
    const cmap = new Map(campaigns.map((c) => [c.id, c]));
    const rows = byCampaign.map((g) => { const c = cmap.get(g.campaignId)!; return { campaign: { id: c.id, name: c.name, status: c.status, dailyBudget: c.dailyBudget != null ? Number(c.dailyBudget) : null, isManagedViaApi: c.isManagedViaApi, source: c.source, channel: `${c.channelAccount.channel.name} · ${c.channelAccount.label}`, accountId: c.channelAccount.id }, ...kpi({ impressions: g._sum.impressions ?? 0, clicks: g._sum.clicks ?? 0, spend: Number(g._sum.spend ?? 0), orders: g._sum.orders ?? 0, sales: Number(g._sum.sales ?? 0) }) }; });
    const total = kpi(rows.reduce((a, r) => ({ impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, spend: a.spend + r.spend, orders: a.orders + r.orders, sales: a.sales + r.sales }), { impressions: 0, clicks: 0, spend: 0, orders: 0, sales: 0 }));
    return {
      range: { from, to }, total, activeCampaigns: campaigns.filter((c) => c.status === 'ACTIVE').length, totalCampaigns: campaigns.length,
      campaigns: rows.sort((a, b) => b.spend - a.spend),
      series: series.map((s) => ({ day: s.day.toISOString().slice(0, 10), spend: Number(s.spend), sales: Number(s.sales), orders: Number(s.orders) })),
      products: byProduct.map((p) => ({ variantId: p.variantId, sku: p.sku, name: p.name, ...kpi({ impressions: Number(p.impressions), clicks: Number(p.clicks), spend: Number(p.spend), orders: Number(p.orders), sales: Number(p.sales) }) })),
      channels: byChannel.map((c) => ({ accountId: c.accountId, label: c.label, channel: c.channel, ...kpi({ impressions: Number(c.impressions), clicks: Number(c.clicks), spend: Number(c.spend), orders: Number(c.orders), sales: Number(c.sales) }) })),
    };
  }

  /** Kural tabanlı analiz (AI gerektirmez): düşük performans, yüksek ACOS, bütçe önerisi. Yalnızca öneri; uygulamaz. */
  async analysis(user: JwtPayload, from: Date, to: Date, targetAcos = 25) {
    const d = await this.dashboard(user, from, to);
    const findings: { campaignId: string; campaign: string; channel: string; severity: 'high' | 'medium' | 'low'; issue: string; suggestion: string; metric: Record<string, number | null> }[] = [];
    for (const c of d.campaigns) {
      if (c.spend <= 0) continue;
      if (c.orders === 0 && c.clicks >= 30) findings.push({ campaignId: c.campaign.id, campaign: c.campaign.name, channel: c.campaign.channel, severity: 'high', issue: `${c.clicks} tıklama, 0 sipariş`, suggestion: 'Kampanyayı durdurmayı veya hedef kelimeleri/ürün sayfasını gözden geçirmeyi düşünün.', metric: { spend: c.spend, clicks: c.clicks } });
      else if (c.acos != null && c.acos > targetAcos * 1.5) findings.push({ campaignId: c.campaign.id, campaign: c.campaign.name, channel: c.campaign.channel, severity: 'high', issue: `ACOS %${c.acos.toFixed(1)} (hedef %${targetAcos})`, suggestion: 'Günlük bütçeyi düşürün veya teklifleri azaltın.', metric: { acos: c.acos, roas: c.roas } });
      else if (c.acos != null && c.acos > targetAcos) findings.push({ campaignId: c.campaign.id, campaign: c.campaign.name, channel: c.campaign.channel, severity: 'medium', issue: `ACOS %${c.acos.toFixed(1)} hedefin üzerinde`, suggestion: 'Düşük dönüşümlü ürünleri kampanyadan çıkarın.', metric: { acos: c.acos } });
      else if (c.acos != null && c.acos < targetAcos * 0.6 && c.roas > 4) findings.push({ campaignId: c.campaign.id, campaign: c.campaign.name, channel: c.campaign.channel, severity: 'low', issue: `ROAS ${c.roas.toFixed(1)} — verimli`, suggestion: 'Bütçeyi kademeli artırmayı (%20) değerlendirin.', metric: { roas: c.roas, acos: c.acos } });
      if (c.ctr < 0.2 && c.impressions > 2000) findings.push({ campaignId: c.campaign.id, campaign: c.campaign.name, channel: c.campaign.channel, severity: 'medium', issue: `CTR %${c.ctr.toFixed(2)} düşük`, suggestion: 'Ana görsel ve başlığı iyileştirin.', metric: { ctr: c.ctr } });
    }
    return { targetAcos, findings: findings.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity])) };
  }

  /** Kampanya durumu/bütçe değişikliği: yalnızca API destekleyen kanalda ve açık kullanıcı eylemiyle. */
  async updateCampaign(user: JwtPayload, campaignId: string, data: { status?: 'ACTIVE' | 'PAUSED'; dailyBudget?: number }) {
    const c = await this.prisma.advertisingCampaign.findFirst({ where: { id: campaignId, organizationId: user.organizationId }, include: { channelAccount: { include: { channel: true } } } });
    if (!c) throw new NotFoundException('Kampanya bulunamadı');
    if (!c.isManagedViaApi) throw new BadRequestException('Bu kampanya API ile yönetilemiyor (Excel ile içe aktarılmış veya kanal desteklemiyor). Değişikliği kanal panelinden yapın.');
    const adapter = this.registry.get(c.channelAccount.channel.code);
    if (!adapter.updateCampaign) throw new UnsupportedOperationError(adapter.displayName, data.dailyBudget != null ? 'ads.budget' : 'ads.pause');
    const r = await adapter.updateCampaign(this.channels.buildContext(c.channelAccount), c.externalId, data);
    if (!r.ok) throw new BadRequestException(`Kanal değişikliği kabul etmedi: ${r.error}`);
    const updated = await this.prisma.advertisingCampaign.update({ where: { id: campaignId }, data: { status: data.status, dailyBudget: data.dailyBudget } });
    await this.audit.log(user, 'ads.campaign_update', 'AdvertisingCampaign', campaignId, { status: c.status, dailyBudget: c.dailyBudget }, data);
    return updated;
  }
}

export function mapCampaignStatus(raw: string): CampaignStatus {
  const s = (raw ?? '').toUpperCase().replace(/[\s_-]/g, '');
  if (['ACTIVE', 'ENABLED', 'RUNNING', 'DELIVERING'].includes(s)) return 'ACTIVE';
  if (['PAUSED', 'STOPPED', 'DISABLED'].includes(s)) return 'PAUSED';
  if (['ENDED', 'ARCHIVED', 'COMPLETED', 'FINISHED'].includes(s)) return 'ENDED';
  if (['DRAFT', 'PENDING'].includes(s)) return 'DRAFT';
  return 'UNKNOWN';
}

function parseDate(v: string) { const m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/); if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])); const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d; }
