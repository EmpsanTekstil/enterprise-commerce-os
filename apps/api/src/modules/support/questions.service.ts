import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChannelAccount, Prisma, QuestionStatus } from '@prisma/client';
import { AdapterContext, ChannelAdapter, UnsupportedOperationError } from '../../integrations/adapter.interface';
import { AdapterRegistry } from '../../integrations/adapter.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';
import { ChannelsService } from '../channels/channels.service';

type Account = ChannelAccount & { channel: { code: string } };
const SLA_HOURS = Number(process.env.QUESTION_SLA_HOURS ?? 24);

@Injectable()
export class QuestionsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private channels: ChannelsService, private registry: AdapterRegistry) {}

  /** Kanaldaki müşteri sorularını çeker; ürünle barkod/externalId üzerinden eşler. */
  async pullQuestions(account: Account, adapter: ChannelAdapter, ctx: AdapterContext, since?: Date) {
    if (!adapter.fetchQuestions) throw new UnsupportedOperationError(adapter.displayName, 'questions.read');
    let cursor: string | undefined; let created = 0, updated = 0, pages = 0;
    const canReply = !!adapter.answerQuestion;
    do {
      const page = await adapter.fetchQuestions(ctx, since ?? new Date(Date.now() - 14 * 86_400_000), cursor);
      pages++;
      for (const q of page.items) {
        const productId = await this.resolveProduct(account, q.productExternalId);
        const channelAnswered = /answer/i.test(q.status);
        const ex = await this.prisma.customerQuestion.findUnique({ where: { channelAccountId_externalId: { channelAccountId: account.id, externalId: q.externalId } } });
        const data = { productId, customerName: q.customerName, text: q.text, askedAt: q.askedAt, canReplyViaApi: canReply, rawSnapshot: q.raw as Prisma.InputJsonValue };
        if (ex) {
          await this.prisma.customerQuestion.update({ where: { id: ex.id }, data: { ...data, status: channelAnswered && ex.status !== 'ANSWERED' ? 'ANSWERED' : undefined } });
          updated++;
        } else {
          await this.prisma.customerQuestion.create({ data: { ...data, organizationId: account.organizationId, channelAccountId: account.id, externalId: q.externalId, status: channelAnswered ? 'ANSWERED' : 'OPEN', dueAt: new Date(q.askedAt.getTime() + SLA_HOURS * 3_600_000) } });
          created++;
        }
      }
      cursor = page.nextCursor;
    } while (cursor && pages < 50);
    return { created, updated, pages };
  }

  private async resolveProduct(account: Account, productExternalId?: string) {
    if (!productExternalId) return undefined;
    const listing = await this.prisma.listing.findFirst({ where: { channelAccountId: account.id, OR: [{ externalId: productExternalId }, { externalSku: productExternalId }], variantId: { not: null } }, include: { variant: { select: { productId: true } } } });
    if (listing?.variant) return listing.variant.productId;
    const v = await this.prisma.productVariant.findFirst({ where: { barcode: productExternalId, product: { organizationId: account.organizationId } }, select: { productId: true } });
    return v?.productId;
  }

  async list(user: JwtPayload, q: { status?: string; accountId?: string; productId?: string; assignedToId?: string; q?: string; page: number; pageSize: number }) {
    const where: Prisma.CustomerQuestionWhereInput = {
      organizationId: user.organizationId, channelAccountId: q.accountId, productId: q.productId, assignedToId: q.assignedToId,
      status: q.status === 'PENDING' ? { in: ['OPEN', 'DRAFTED'] } : (q.status as QuestionStatus | undefined),
      ...(q.q ? { OR: [{ text: { contains: q.q, mode: 'insensitive' } }, { customerName: { contains: q.q, mode: 'insensitive' } }, { product: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customerQuestion.findMany({ where, include: { product: { select: { id: true, name: true } }, channelAccount: { select: { id: true, label: true, channel: { select: { code: true, name: true } } } }, assignedTo: { select: { id: true, fullName: true } }, responses: { orderBy: { createdAt: 'desc' }, include: { author: { select: { fullName: true } } } } }, orderBy: [{ status: 'asc' }, { askedAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.customerQuestion.count({ where }),
    ]);
    const countRows = await this.prisma.$queryRaw<{ status: string; count: bigint }[]>`SELECT status::text AS status, COUNT(*)::bigint AS count FROM "CustomerQuestion" WHERE "organizationId" = ${user.organizationId} GROUP BY status`;
    const now = Date.now();
    return {
      items: items.map((i) => ({ ...i, overdue: ['OPEN', 'DRAFTED'].includes(i.status) && !!i.dueAt && i.dueAt.getTime() < now })),
      total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize),
      counts: Object.fromEntries(countRows.map((c) => [c.status, Number(c.count)])),
    };
  }

  async assign(user: JwtPayload, id: string, assignedToId: string | null) {
    await this.getOwned(user, id);
    if (assignedToId) { const u = await this.prisma.user.findFirst({ where: { id: assignedToId, organizationId: user.organizationId } }); if (!u) throw new NotFoundException('Kullanıcı bulunamadı'); }
    return this.prisma.customerQuestion.update({ where: { id }, data: { assignedToId } });
  }

  /** Taslak kaydeder (insan veya şablon). Gönderilmez. */
  async draft(user: JwtPayload, id: string, text: string, source: 'HUMAN' | 'TEMPLATE' | 'AI_DRAFT' = 'HUMAN') {
    const q = await this.getOwned(user, id);
    if (q.status === 'ANSWERED') throw new BadRequestException('Cevaplanmış soruya taslak eklenemez');
    const r = await this.prisma.questionResponse.create({ data: { questionId: id, authorId: user.sub, source, text } });
    await this.prisma.customerQuestion.update({ where: { id }, data: { status: 'DRAFTED' } });
    return r;
  }

  /** Onayla ve kanala gönder. Yalnızca kullanıcı onayıyla çalışır; API yoksa 'panelden gönderildi' olarak işaretlenebilir. */
  async send(user: JwtPayload, id: string, responseId: string, markOnly = false) {
    const q = await this.prisma.customerQuestion.findFirst({ where: { id, organizationId: user.organizationId }, include: { channelAccount: { include: { channel: true } } } });
    if (!q) throw new NotFoundException('Soru bulunamadı');
    const r = await this.prisma.questionResponse.findFirst({ where: { id: responseId, questionId: id } });
    if (!r) throw new NotFoundException('Cevap taslağı bulunamadı');
    if (r.sentAt) throw new BadRequestException('Bu cevap zaten gönderilmiş');
    if (r.text.trim().length < 10) throw new BadRequestException('Cevap en az 10 karakter olmalı');
    const adapter = this.registry.get(q.channelAccount.channel.code);
    if (!markOnly) {
      if (!adapter.answerQuestion) throw new UnsupportedOperationError(adapter.displayName, 'questions.answer');
      const res = await adapter.answerQuestion(this.channels.buildContext(q.channelAccount), q.externalId, r.text);
      if (!res.ok) { await this.prisma.questionResponse.update({ where: { id: responseId }, data: { error: res.error } }); throw new BadRequestException(`Kanal cevabı kabul etmedi: ${res.error}`); }
    }
    await this.prisma.$transaction([
      this.prisma.questionResponse.update({ where: { id: responseId }, data: { isApproved: true, sentAt: new Date(), error: null } }),
      this.prisma.customerQuestion.update({ where: { id }, data: { status: 'ANSWERED' } }),
    ]);
    await this.audit.log(user, markOnly ? 'question.mark_answered' : 'question.answer', 'CustomerQuestion', id, null, { responseId, source: r.source });
    return { ok: true };
  }

  async close(user: JwtPayload, id: string) { await this.getOwned(user, id); return this.prisma.customerQuestion.update({ where: { id }, data: { status: 'CLOSED' } }); }

  // Şablonlar
  templates(user: JwtPayload) { return this.prisma.replyTemplate.findMany({ where: { organizationId: user.organizationId }, orderBy: { title: 'asc' } }); }
  createTemplate(user: JwtPayload, title: string, body: string) { return this.prisma.replyTemplate.create({ data: { organizationId: user.organizationId, title, body } }); }
  async deleteTemplate(user: JwtPayload, id: string) { await this.prisma.replyTemplate.deleteMany({ where: { id, organizationId: user.organizationId } }); return { ok: true }; }

  private async getOwned(user: JwtPayload, id: string) {
    const q = await this.prisma.customerQuestion.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!q) throw new NotFoundException('Soru bulunamadı');
    return q;
  }
}
