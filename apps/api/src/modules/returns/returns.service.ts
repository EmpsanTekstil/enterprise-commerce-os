import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChannelAccount, Prisma, ReturnStatus } from '@prisma/client';
import { AdapterContext, ChannelAdapter, ExternalReturn, UnsupportedOperationError } from '../../integrations/adapter.interface';
import { AdapterRegistry } from '../../integrations/adapter.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';
import { ChannelsService } from '../channels/channels.service';

type Account = ChannelAccount & { channel: { code: string } };

export function mapReturnStatus(raw: string): ReturnStatus {
  const s = (raw ?? '').toLowerCase().replace(/[\s_-]/g, '');
  if (['accepted', 'approved', 'waitingfraudcheck'].includes(s)) return 'APPROVED';
  if (['rejected'].includes(s)) return 'REJECTED';
  if (['cancelled', 'canceled', 'closed'].includes(s)) return 'CLOSED';
  if (['refunded'].includes(s)) return 'REFUNDED';
  if (['intransit', 'shipped'].includes(s)) return 'IN_TRANSIT';
  if (['received', 'delivered'].includes(s)) return 'RECEIVED';
  return 'REQUESTED'; // Created, WaitingInAction, Unresolved, InAnalysis
}

@Injectable()
export class ReturnsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private channels: ChannelsService, private registry: AdapterRegistry) {}

  /** Kanaldaki iade taleplerini çeker; sipariş numarasıyla siparişe bağlar (bağlanamayanlar atlanır ve raporlanır). */
  async pullReturns(account: Account, adapter: ChannelAdapter, ctx: AdapterContext, since?: Date) {
    if (!adapter.fetchReturns) throw new UnsupportedOperationError(adapter.displayName, 'returns.read');
    let cursor: string | undefined; let created = 0, updated = 0, unmatched = 0, pages = 0;
    const canAct = !!adapter.approveReturn;
    do {
      const page = await adapter.fetchReturns(ctx, since ?? new Date(Date.now() - 14 * 86_400_000), cursor);
      pages++;
      for (const r of page.items) {
        const order = await this.findOrder(account.id, r);
        if (!order) { unmatched++; continue; }
        const data = {
          channelStatus: r.status, status: mapReturnStatus(r.status), reason: r.reason, customerName: r.customerName, trackingNumber: r.trackingNumber,
          itemsJson: r.items as unknown as Prisma.InputJsonValue, rawSnapshot: r.raw as Prisma.InputJsonValue, canActViaApi: canAct,
        };
        const ex = await this.prisma.return.findUnique({ where: { orderId_externalId: { orderId: order.id, externalId: r.externalId } } });
        if (ex) { await this.prisma.return.update({ where: { id: ex.id }, data: { ...data, resolvedAt: ['APPROVED', 'REJECTED', 'CLOSED', 'REFUNDED'].includes(data.status) ? ex.resolvedAt ?? new Date() : null } }); updated++; }
        else { await this.prisma.return.create({ data: { ...data, orderId: order.id, externalId: r.externalId, requestedAt: r.requestedAt } }); created++; }
      }
      cursor = page.nextCursor;
    } while (cursor && pages < 100);
    return { created, updated, unmatched, pages };
  }

  private findOrder(accountId: string, r: ExternalReturn) {
    return this.prisma.order.findFirst({ where: { channelAccountId: accountId, OR: [{ externalId: r.orderExternalId ?? '__' }, { orderNumber: r.orderNumber ?? '__' }] } });
  }

  async list(user: JwtPayload, q: { status?: string; accountId?: string; page: number; pageSize: number }) {
    const where: Prisma.ReturnWhereInput = { order: { organizationId: user.organizationId, channelAccountId: q.accountId }, status: q.status as ReturnStatus | undefined };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.return.findMany({ where, include: { order: { select: { id: true, orderNumber: true, externalId: true, customerName: true, channelAccount: { select: { id: true, label: true, channel: { select: { code: true, name: true } } } } } } }, orderBy: { requestedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.return.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize) };
  }

  async approve(user: JwtPayload, id: string, claimItemIds?: string[]) {
    const { ret, adapter, ctx, items } = await this.loadForAction(user, id, claimItemIds);
    if (!adapter.approveReturn) throw new UnsupportedOperationError(adapter.displayName, 'returns.update');
    const r = await adapter.approveReturn(ctx, ret.externalId!, items);
    if (!r.ok) throw new BadRequestException(`Kanal onayı reddetti: ${r.error}`);
    const updated = await this.prisma.return.update({ where: { id }, data: { status: 'APPROVED', resolvedAt: new Date() } });
    await this.audit.log(user, 'return.approve', 'Return', id, { status: ret.status }, { items });
    return updated;
  }

  async reject(user: JwtPayload, id: string, reasonId: string, description: string, claimItemIds?: string[]) {
    const { ret, adapter, ctx, items } = await this.loadForAction(user, id, claimItemIds);
    if (!adapter.rejectReturn) throw new UnsupportedOperationError(adapter.displayName, 'returns.update');
    const r = await adapter.rejectReturn(ctx, ret.externalId!, items, reasonId, description);
    if (!r.ok) throw new BadRequestException(`Ret talebi gönderilemedi: ${r.error}`);
    const updated = await this.prisma.return.update({ where: { id }, data: { status: 'REJECTED', resolvedAt: new Date() } });
    await this.audit.log(user, 'return.reject', 'Return', id, { status: ret.status }, { reasonId, description, items });
    return updated;
  }

  async rejectReasons(user: JwtPayload, accountId: string) {
    const account = await this.channels.getOwned(user, accountId);
    const adapter = this.registry.get(account.channel.code);
    if (!adapter.fetchReturnRejectReasons) return [];
    return adapter.fetchReturnRejectReasons(this.channels.buildContext(account));
  }

  /** Fiziksel kontrol sonrası iade edilen ürünleri stoğa alır; her kalem için bir kez (referenceKey benzersiz). */
  async restock(user: JwtPayload, id: string, warehouseCode?: string) {
    const ret = await this.prisma.return.findFirst({ where: { id, order: { organizationId: user.organizationId } }, include: { order: { include: { items: true } } } });
    if (!ret) throw new NotFoundException('İade bulunamadı');
    if (ret.stockRestored) throw new BadRequestException('Bu iade zaten stoğa alınmış');
    const wh = await this.prisma.warehouse.findFirst({ where: { organizationId: user.organizationId, ...(warehouseCode ? { code: warehouseCode } : { isDefault: true }) } });
    if (!wh) throw new NotFoundException('Depo bulunamadı');
    const items = (ret.itemsJson as unknown as ExternalReturn['items']) ?? [];
    let restored = 0; const skipped: string[] = [];
    for (const it of items) {
      const oi = ret.order.items.find((x) => (it.orderLineExternalId && x.externalId === it.orderLineExternalId) || (it.barcode && x.barcode === it.barcode) || (it.sku && x.sku === it.sku));
      if (!oi?.variantId) { skipped.push(it.name ?? it.barcode ?? it.claimItemId); continue; }
      const qty = it.quantity ?? oi.quantity;
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.inventoryMovement.create({ data: { warehouseId: wh.id, variantId: oi.variantId!, type: 'RETURN_IN', quantity: qty, referenceKey: `return:${ret.id}:item:${it.claimItemId}`, note: `İade ${ret.externalId ?? ret.id} stoğa alındı`, createdById: user.sub } });
          await tx.inventoryBalance.upsert({ where: { warehouseId_variantId: { warehouseId: wh.id, variantId: oi.variantId! } }, update: { onHand: { increment: qty } }, create: { warehouseId: wh.id, variantId: oi.variantId!, onHand: qty } });
        });
        restored += qty;
      } catch (e) { if ((e as { code?: string }).code !== 'P2002') throw e; }
    }
    await this.prisma.return.update({ where: { id }, data: { stockRestored: true, status: ret.status === 'APPROVED' || ret.status === 'IN_TRANSIT' ? 'RECEIVED' : ret.status } });
    await this.audit.log(user, 'return.restock', 'Return', id, null, { restored, skipped });
    return { restored, skipped };
  }

  private async loadForAction(user: JwtPayload, id: string, claimItemIds?: string[]) {
    const ret = await this.prisma.return.findFirst({ where: { id, order: { organizationId: user.organizationId } }, include: { order: { include: { channelAccount: { include: { channel: true } } } } } });
    if (!ret) throw new NotFoundException('İade bulunamadı');
    if (!ret.externalId) throw new BadRequestException('Bu iade bir kanaldan gelmedi; işlem yapılamaz');
    if (ret.status !== 'REQUESTED') throw new BadRequestException(`Yalnızca bekleyen iadelerde işlem yapılabilir (durum: ${ret.status})`);
    const adapter = this.registry.get(ret.order.channelAccount.channel.code);
    const ctx = this.channels.buildContext(ret.order.channelAccount);
    const all = ((ret.itemsJson as unknown as ExternalReturn['items']) ?? []).map((i) => i.claimItemId);
    const items = claimItemIds?.length ? claimItemIds.filter((i) => all.includes(i)) : all;
    if (!items.length) throw new BadRequestException('İşlem yapılacak iade kalemi yok');
    return { ret, adapter, ctx, items };
  }
}
