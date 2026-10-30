import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';
import { NotificationsService } from './notifications.service';

/** Kural tetikleyicileri; her biri değerlendirme fonksiyonuyla eşleşir. */
export const TRIGGERS: { key: string; name: string; description: string; conditionHint?: string }[] = [
  { key: 'low_stock', name: 'Stok azaldı', description: 'Satılabilir stok kritik eşiğin altına indi', conditionHint: '{"threshold": 5} (boşsa ürünün kendi eşiği)' },
  { key: 'new_order', name: 'Yeni sipariş', description: 'Son kontrolden beri yeni sipariş geldi' },
  { key: 'new_question', name: 'Yeni müşteri sorusu', description: 'Cevap bekleyen yeni soru var' },
  { key: 'question_overdue', name: 'Soru yanıt süresi aşıldı', description: 'SLA süresi geçen cevapsız soru var' },
  { key: 'negative_review', name: 'Olumsuz yorum', description: 'Yeni 1-2 yıldızlı yorum' },
  { key: 'api_disconnected', name: 'API bağlantısı koptu', description: 'Bir kanal hesabı ERROR durumuna düştü' },
  { key: 'listing_rejected', name: 'Ürün yayını reddedildi', description: 'Kanal, gönderilen ürünü reddetti' },
  { key: 'order_delayed', name: 'Sipariş gecikti', description: 'Kargolanmamış sipariş X saati aştı', conditionHint: '{"hours": 48}' },
  { key: 'ad_spend_limit', name: 'Reklam harcaması sınırı', description: 'Günlük reklam harcaması limiti aştı', conditionHint: '{"dailyLimit": 1000}' },
  { key: 'stock_mismatch', name: 'Stok mutabakatsızlığı', description: 'Kanal stoğu merkezi stoktan farklı' },
];

@Injectable()
export class AutomationService {
  private readonly log = new Logger(AutomationService.name);
  constructor(private prisma: PrismaService, private audit: AuditService, private notifications: NotificationsService) {}

  triggers() { return TRIGGERS; }
  rules(user: JwtPayload) { return this.prisma.automationRule.findMany({ where: { organizationId: user.organizationId }, orderBy: { createdAt: 'asc' } }); }

  async save(user: JwtPayload, data: { name: string; trigger: string; condition?: Record<string, unknown>; isEnabled?: boolean }, id?: string) {
    if (!TRIGGERS.some((t) => t.key === data.trigger)) throw new NotFoundException(`Bilinmeyen tetikleyici: ${data.trigger}`);
    const d = { name: data.name, trigger: data.trigger, conditionJson: (data.condition ?? {}) as Prisma.InputJsonValue, actionJson: { type: 'notify' } as Prisma.InputJsonValue, isEnabled: data.isEnabled ?? true };
    const r = id ? await this.prisma.automationRule.update({ where: { id }, data: d }) : await this.prisma.automationRule.create({ data: { ...d, organizationId: user.organizationId } });
    await this.audit.log(user, id ? 'automation.update' : 'automation.create', 'AutomationRule', r.id, null, data);
    return r;
  }

  async toggle(user: JwtPayload, id: string, isEnabled: boolean) { const r = await this.prisma.automationRule.updateMany({ where: { id, organizationId: user.organizationId }, data: { isEnabled } }); return { updated: r.count }; }
  async remove(user: JwtPayload, id: string) { await this.prisma.automationRule.deleteMany({ where: { id, organizationId: user.organizationId } }); return { ok: true }; }

  /** Varsayılan kural seti (ilk kurulumda tek tıkla). */
  async installDefaults(user: JwtPayload) {
    const existing = new Set((await this.rules(user)).map((r) => r.trigger));
    let created = 0;
    for (const t of TRIGGERS) { if (!existing.has(t.key)) { await this.save(user, { name: t.name, trigger: t.key, condition: t.key === 'order_delayed' ? { hours: 48 } : {} }); created++; } }
    return { created };
  }

  /** Tüm organizasyonların etkin kurallarını değerlendirir (zamanlayıcı çağırır). */
  async evaluateAll() {
    const rules = await this.prisma.automationRule.findMany({ where: { isEnabled: true } });
    let fired = 0;
    for (const rule of rules) {
      try { if (await this.evaluate(rule)) { fired++; await this.prisma.automationRule.update({ where: { id: rule.id }, data: { lastFiredAt: new Date() } }); } }
      catch (e) { this.log.error(`Kural ${rule.name}: ${(e as Error).message}`); }
    }
    return { evaluated: rules.length, fired };
  }

  private async evaluate(rule: { id: string; organizationId: string; trigger: string; conditionJson: Prisma.JsonValue; lastFiredAt: Date | null }): Promise<boolean> {
    const org = rule.organizationId; const cond = (rule.conditionJson ?? {}) as Record<string, number>; const since = rule.lastFiredAt ?? new Date(Date.now() - 86_400_000);
    const n = (level: 'INFO' | 'WARNING' | 'ERROR', title: string, body: string, link: string) => this.notifications.notify(org, level, title, body, link);
    switch (rule.trigger) {
      case 'low_stock': {
        const rows = await this.prisma.$queryRaw<{ sku: string; name: string; available: number }[]>`SELECT pv.sku, p.name, SUM(ib."onHand" - ib.reserved)::int AS available FROM "InventoryBalance" ib JOIN "ProductVariant" pv ON pv.id = ib."variantId" JOIN "Product" p ON p.id = pv."productId" WHERE p."organizationId" = ${org} AND p.status = 'ACTIVE' GROUP BY pv.id, pv.sku, p.name, ib."reorderPoint" HAVING SUM(ib."onHand" - ib.reserved) <= ${cond.threshold ?? null}::int OR (${cond.threshold ?? null}::int IS NULL AND SUM(ib."onHand" - ib.reserved) <= MAX(ib."reorderPoint"))`;
        if (!rows.length) return false;
        await n('WARNING', `${rows.length} üründe kritik stok`, rows.slice(0, 10).map((r) => `${r.name} (${r.sku}): ${r.available}`).join('\n'), '/stok?lowOnly=1'); return true;
      }
      case 'new_order': { const c = await this.prisma.order.count({ where: { organizationId: org, isDemo: false, createdAt: { gt: since } } }); if (!c) return false; await n('INFO', `${c} yeni sipariş`, 'Siparişler ekranından inceleyin.', '/siparisler'); return true; }
      case 'new_question': { const c = await this.prisma.customerQuestion.count({ where: { organizationId: org, status: 'OPEN', createdAt: { gt: since } } }); if (!c) return false; await n('INFO', `${c} yeni müşteri sorusu`, 'Cevap bekliyor.', '/sorular'); return true; }
      case 'question_overdue': { const c = await this.prisma.customerQuestion.count({ where: { organizationId: org, status: { in: ['OPEN', 'DRAFTED'] }, dueAt: { lt: new Date() } } }); if (!c) return false; await n('WARNING', `${c} sorunun yanıt süresi aşıldı`, 'Hemen cevaplayın.', '/sorular?status=PENDING'); return true; }
      case 'negative_review': { const c = await this.prisma.productReview.count({ where: { organizationId: org, rating: { lte: 2 }, createdAt: { gt: since } } }); if (!c) return false; await n('WARNING', `${c} yeni olumsuz yorum`, '1-2 yıldızlı yorumlar.', '/yorumlar?sentiment=NEGATIVE'); return true; }
      case 'api_disconnected': { const a = await this.prisma.channelAccount.findMany({ where: { organizationId: org, status: 'ERROR' }, include: { channel: true } }); if (!a.length) return false; await n('ERROR', `${a.length} kanal bağlantısı hatalı`, a.map((x) => `${x.channel.name} · ${x.label}: ${x.lastError ?? ''}`).join('\n'), '/entegrasyonlar'); return true; }
      case 'listing_rejected': { const c = await this.prisma.listing.count({ where: { channelAccount: { organizationId: org }, status: 'REJECTED', updatedAt: { gt: since } } }); if (!c) return false; await n('ERROR', `${c} ürün yayını reddedildi`, 'Red sebeplerini Yayınlar ekranında görün.', '/yayinlar?status=REJECTED'); return true; }
      case 'order_delayed': { const h = cond.hours ?? 48; const c = await this.prisma.order.count({ where: { organizationId: org, isDemo: false, status: { in: ['NEW', 'CONFIRMED', 'PICKING', 'PACKED'] }, orderedAt: { lt: new Date(Date.now() - h * 3_600_000) } } }); if (!c) return false; await n('WARNING', `${c} sipariş ${h} saattir kargolanmadı`, 'Kargo ve İadeler ekranından kontrol edin.', '/kargo'); return true; }
      case 'ad_spend_limit': { const lim = cond.dailyLimit; if (!lim) return false; const t = new Date(); t.setHours(0, 0, 0, 0); const s = await this.prisma.advertisingMetric.aggregate({ where: { campaign: { organizationId: org }, date: { gte: t } }, _sum: { spend: true } }); const spend = Number(s._sum.spend ?? 0); if (spend <= lim) return false; await n('WARNING', `Günlük reklam harcaması limiti aştı`, `${spend.toFixed(2)} ₺ / limit ${lim} ₺`, '/reklam'); return true; }
      case 'stock_mismatch': { const rows = await this.prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM "Listing" l JOIN "ChannelAccount" ca ON ca.id = l."channelAccountId" JOIN "ProductVariant" pv ON pv.id = l."variantId" WHERE ca."organizationId" = ${org} AND l.status = 'ACTIVE' AND l."stockQuantity" IS NOT NULL AND l."stockQuantity" <> (SELECT COALESCE(SUM(ib."onHand" - ib.reserved),0) FROM "InventoryBalance" ib WHERE ib."variantId" = pv.id)`; const c = Number(rows[0]?.c ?? 0); if (!c) return false; await n('WARNING', `${c} ilanda stok farkı`, 'Mutabakat ekranından inceleyin.', '/stok'); return true; }
      default: return false;
    }
  }
}
