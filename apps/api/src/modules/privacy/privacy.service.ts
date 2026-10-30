import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';

/**
 * KVKK VERİ SAKLAMA
 * Organizasyon başına iki süre (gün): piiMaskAfterDays → sipariş/iade/soru/yorumlardaki müşteri kimlik bilgisi (ad, e-posta,
 * telefon, adres) kalıcı olarak maskelenir; rawPurgeAfterDays → kanaldan gelen ham veri (rawSnapshot) silinir.
 * null = kapalı. İş günde bir kez zamanlayıcıdan, istenirse elle çalışır; işlemler idempotenttir ve geri alınamaz.
 */
export const MASKED_NAME = 'Maskelendi (KVKK)';

export interface RetentionSettings { piiMaskAfterDays: number | null; rawPurgeAfterDays: number | null; piiLastRunAt: Date | null }
export interface RetentionPreview { cutoffMask: Date | null; cutoffRaw: Date | null; orders: number; returns: number; questions: number; reviews: number; raw: number }

@Injectable()
export class PrivacyService {
  private readonly log = new Logger(PrivacyService.name);
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async getSettings(organizationId: string): Promise<RetentionSettings> {
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { piiMaskAfterDays: true, rawPurgeAfterDays: true, piiLastRunAt: true } });
    return o;
  }

  async updateSettings(user: JwtPayload, data: { piiMaskAfterDays?: number | null; rawPurgeAfterDays?: number | null }) {
    for (const [k, v] of Object.entries(data)) if (v !== null && v !== undefined && (!Number.isInteger(v) || v < 1 || v > 3650)) throw new BadRequestException(`${k} 1–3650 gün arasında olmalı ya da boş (kapalı)`);
    if (data.rawPurgeAfterDays != null && data.piiMaskAfterDays != null && data.rawPurgeAfterDays > data.piiMaskAfterDays) throw new BadRequestException('Ham veri silme süresi, maskeleme süresinden uzun olamaz (ham veri kimlik bilgisi içerir)');
    const before = await this.getSettings(user.organizationId);
    const after = await this.prisma.organization.update({ where: { id: user.organizationId }, data, select: { piiMaskAfterDays: true, rawPurgeAfterDays: true, piiLastRunAt: true } });
    await this.audit.log(user, 'privacy.settings', 'Organization', user.organizationId, before, after);
    return after;
  }

  private cutoff(days: number | null) { return days == null ? null : new Date(Date.now() - days * 86_400_000); }

  /** Çalıştırılsa neler etkilenir (sayılar). */
  async preview(organizationId: string): Promise<RetentionPreview> {
    const s = await this.getSettings(organizationId);
    const cm = this.cutoff(s.piiMaskAfterDays); const cr = this.cutoff(s.rawPurgeAfterDays);
    const org = { organizationId };
    const [orders, returns, questions, reviews] = cm ? await Promise.all([
      this.prisma.order.count({ where: { ...org, orderedAt: { lt: cm }, piiMaskedAt: null } }),
      this.prisma.return.count({ where: { order: org, requestedAt: { lt: cm }, customerName: { not: null } } }),
      this.prisma.customerQuestion.count({ where: { ...org, askedAt: { lt: cm }, customerName: { not: null } } }),
      this.prisma.productReview.count({ where: { ...org, reviewedAt: { lt: cm }, customerName: { not: null } } }),
    ]) : [0, 0, 0, 0];
    const raw = cr ? (await Promise.all([
      this.prisma.order.count({ where: { ...org, orderedAt: { lt: cr }, rawSnapshot: { not: Prisma.DbNull } } }),
      this.prisma.return.count({ where: { order: org, requestedAt: { lt: cr }, rawSnapshot: { not: Prisma.DbNull } } }),
      this.prisma.customerQuestion.count({ where: { ...org, askedAt: { lt: cr }, rawSnapshot: { not: Prisma.DbNull } } }),
      this.prisma.productReview.count({ where: { ...org, reviewedAt: { lt: cr }, rawSnapshot: { not: Prisma.DbNull } } }),
    ])).reduce((a, b) => a + b, 0) : 0;
    return { cutoffMask: cm, cutoffRaw: cr, orders, returns, questions, reviews, raw };
  }

  /** Maskeleme ve ham veri silme; sonuç denetim kaydına yazılır. */
  async run(organizationId: string, user: JwtPayload | null = null) {
    const s = await this.getSettings(organizationId);
    const cm = this.cutoff(s.piiMaskAfterDays); const cr = this.cutoff(s.rawPurgeAfterDays);
    const org = { organizationId }; const now = new Date();
    const result = { orders: 0, returns: 0, questions: 0, reviews: 0, raw: 0 };
    if (cm) {
      result.orders = (await this.prisma.order.updateMany({ where: { ...org, orderedAt: { lt: cm }, piiMaskedAt: null }, data: { customerName: MASKED_NAME, customerEmail: null, customerPhone: null, shippingAddress: Prisma.DbNull, billingAddress: Prisma.DbNull, rawSnapshot: Prisma.DbNull, piiMaskedAt: now } })).count;
      result.returns = (await this.prisma.return.updateMany({ where: { order: org, requestedAt: { lt: cm }, customerName: { not: null } }, data: { customerName: null, rawSnapshot: Prisma.DbNull } })).count;
      result.questions = (await this.prisma.customerQuestion.updateMany({ where: { ...org, askedAt: { lt: cm }, customerName: { not: null } }, data: { customerName: null } })).count;
      result.reviews = (await this.prisma.productReview.updateMany({ where: { ...org, reviewedAt: { lt: cm }, customerName: { not: null } }, data: { customerName: null } })).count;
    }
    if (cr) {
      const r = await Promise.all([
        this.prisma.order.updateMany({ where: { ...org, orderedAt: { lt: cr }, rawSnapshot: { not: Prisma.DbNull } }, data: { rawSnapshot: Prisma.DbNull } }),
        this.prisma.return.updateMany({ where: { order: org, requestedAt: { lt: cr }, rawSnapshot: { not: Prisma.DbNull } }, data: { rawSnapshot: Prisma.DbNull } }),
        this.prisma.customerQuestion.updateMany({ where: { ...org, askedAt: { lt: cr }, rawSnapshot: { not: Prisma.DbNull } }, data: { rawSnapshot: Prisma.DbNull } }),
        this.prisma.productReview.updateMany({ where: { ...org, reviewedAt: { lt: cr }, rawSnapshot: { not: Prisma.DbNull } }, data: { rawSnapshot: Prisma.DbNull } }),
      ]);
      result.raw = r.reduce((a, b) => a + b.count, 0);
    }
    await this.prisma.organization.update({ where: { id: organizationId }, data: { piiLastRunAt: now } });
    if (cm || cr) await this.audit.log(user, 'privacy.run', 'Organization', organizationId, { cutoffMask: cm, cutoffRaw: cr }, result, organizationId);
    return { ranAt: now, ...result };
  }

  /** Zamanlayıcı: saklama süresi tanımlı ve son 24 saatte çalışmamış organizasyonlar. */
  async runDue() {
    const due = await this.prisma.organization.findMany({
      where: { OR: [{ piiMaskAfterDays: { not: null } }, { rawPurgeAfterDays: { not: null } }], AND: [{ OR: [{ piiLastRunAt: null }, { piiLastRunAt: { lt: new Date(Date.now() - 86_400_000) } }] }] },
      select: { id: true },
    });
    for (const o of due) {
      try { const r = await this.run(o.id); if (r.orders || r.returns || r.questions || r.reviews || r.raw) this.log.log(`KVKK ${o.id}: ${JSON.stringify(r)}`); }
      catch (e) { this.log.error(`KVKK ${o.id}: ${(e as Error).message}`); }
    }
    return due.length;
  }
}
