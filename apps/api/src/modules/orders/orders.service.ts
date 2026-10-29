import { Injectable, NotFoundException } from '@nestjs/common';
import { ChannelAccount, OrderStatus, Prisma } from '@prisma/client';
import { AdapterContext, ChannelAdapter, ExternalOrder, UnsupportedOperationError } from '../../integrations/adapter.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth/auth.service';

type Account = ChannelAccount & { channel: { code: string } };

/** Kanal durumlarının genel eşlemesi (adaptör kendi mapOrderStatus'unu verebilir). */
export function mapOrderStatus(raw: string): OrderStatus {
  const s = (raw ?? '').toLowerCase().replace(/[\s_-]/g, '');
  if (['created', 'new', 'awaiting', 'verified', 'pending', 'unpacked'].includes(s)) return 'NEW';
  if (['confirmed', 'approved'].includes(s)) return 'CONFIRMED';
  if (['picking', 'preparing', 'processing'].includes(s)) return 'PICKING';
  if (['invoiced', 'packed', 'readytoship'].includes(s)) return 'PACKED';
  if (['shipped', 'intransit', 'undelivered', 'atcollectionpoint'].includes(s)) return 'SHIPPED';
  if (['delivered', 'completed'].includes(s)) return 'DELIVERED';
  if (['cancelled', 'canceled', 'unsupplied'].includes(s)) return 'CANCELLED';
  if (['returned', 'refunded'].includes(s)) return 'RETURNED';
  return 'UNKNOWN';
}

const STOCK_CONSUMING: OrderStatus[] = ['NEW', 'CONFIRMED', 'PICKING', 'PACKED', 'SHIPPED', 'DELIVERED', 'UNKNOWN'];
// İade (RETURNED) otomatik stok iadesi yapmaz: ürün fiziksel kontrol sonrası İadeler ekranından 'Stoğa al' ile girilir.
const STOCK_RELEASING: OrderStatus[] = ['CANCELLED'];

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Siparişleri çeker ve (channelAccountId, externalId) üzerinden upsert eder.
   * Stok düşümü InventoryMovement.(referenceKey,type) benzersizliğiyle korunur:
   * aynı sipariş kalemi için ikinci SALE_OUT yazılamaz → çift düşüm imkânsız.
   */
  async pullOrders(account: Account, adapter: ChannelAdapter, ctx: AdapterContext, since?: Date) {
    if (!adapter.fetchOrders) throw new UnsupportedOperationError(adapter.displayName, 'orders.read');
    const from = since ?? new Date(Date.now() - 7 * 86_400_000);
    let cursor: string | undefined;
    let created = 0, updated = 0, stockOut = 0, stockIn = 0, pages = 0;
    const touchedVariants = new Set<string>();
    do {
      const page = await adapter.fetchOrders(ctx, from, cursor);
      pages++;
      for (const o of page.items) {
        const r = await this.upsertOrder(account, adapter, o);
        if (r.created) created++; else updated++;
        stockOut += r.stockOut; stockIn += r.stockIn;
        r.variantIds.forEach((v) => touchedVariants.add(v));
      }
      cursor = page.nextCursor;
    } while (cursor && pages < 200);
    return { created, updated, stockOut, stockIn, pages, touchedVariants: [...touchedVariants] };
  }

  private async upsertOrder(account: Account, adapter: ChannelAdapter, o: ExternalOrder) {
    const status = (adapter.mapOrderStatus?.(o.status) as OrderStatus | undefined) ?? mapOrderStatus(o.status);
    const existing = await this.prisma.order.findUnique({ where: { channelAccountId_externalId: { channelAccountId: account.id, externalId: o.externalId } }, include: { items: true } });

    // Kalemleri merkezi varyantlarla eşle (barkod > SKU)
    const resolved = await Promise.all(o.items.map(async (it) => {
      let variantId: string | null = null;
      if (it.barcode) variantId = (await this.prisma.productVariant.findFirst({ where: { barcode: it.barcode, product: { organizationId: account.organizationId } }, select: { id: true } }))?.id ?? null;
      if (!variantId && it.sku) variantId = (await this.prisma.productVariant.findFirst({ where: { sku: it.sku, product: { organizationId: account.organizationId } }, select: { id: true } }))?.id ?? null;
      return { ...it, variantId };
    }));
    const commissionTotal = resolved.reduce((s, i) => s + (i.commission ?? 0), 0);

    const base = {
      orderNumber: o.orderNumber, status, channelStatus: o.status, customerName: o.customer?.name, customerEmail: o.customer?.email, customerPhone: o.customer?.phone,
      shippingAddress: o.shippingAddress as Prisma.InputJsonValue | undefined, currency: o.currency, grandTotal: o.grandTotal,
      subtotal: resolved.reduce((s, i) => s + i.lineTotal, 0), commissionTotal, orderedAt: o.orderedAt, rawSnapshot: o.raw as Prisma.InputJsonValue,
      isDemo: account.isDemo,
    };

    const order = existing
      ? await this.prisma.order.update({ where: { id: existing.id }, data: base })
      : await this.prisma.order.create({
          data: {
            ...base, organizationId: account.organizationId, channelAccountId: account.id, externalId: o.externalId,
            items: { create: resolved.map((i) => ({ externalId: i.externalId, variantId: i.variantId, sku: i.sku, barcode: i.barcode, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal, commission: i.commission })) },
          },
        });

    if (existing && existing.status !== status) {
      await this.prisma.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: existing.status, toStatus: status, note: `Kanal durumu: ${o.status}` } });
    } else if (!existing) {
      await this.prisma.orderStatusHistory.create({ data: { orderId: order.id, toStatus: status, note: `Kanal durumu: ${o.status}` } });
    }

    // Kargo bilgisi
    if (o.shipment && (o.shipment.trackingNumber || o.shipment.carrierName)) {
      const sh = await this.prisma.shipment.findFirst({ where: { orderId: order.id } });
      const data = { carrierName: o.shipment.carrierName, trackingNumber: o.shipment.trackingNumber, trackingUrl: o.shipment.trackingUrl, status: status === 'DELIVERED' ? 'DELIVERED' as const : status === 'SHIPPED' ? 'IN_TRANSIT' as const : undefined };
      if (sh) await this.prisma.shipment.update({ where: { id: sh.id }, data });
      else await this.prisma.shipment.create({ data: { orderId: order.id, ...data, status: data.status ?? 'PENDING' } });
    }

    // Stok hareketleri (idempotent)
    const items = existing?.items ?? (await this.prisma.orderItem.findMany({ where: { orderId: order.id } }));
    const wh = await this.prisma.warehouse.findFirst({ where: { organizationId: account.organizationId, isDefault: true } });
    let stockOut = 0, stockIn = 0;
    const variantIds: string[] = [];
    if (wh) {
      for (const it of items) {
        if (!it.variantId) continue;
        variantIds.push(it.variantId);
        const key = `order:${order.id}:item:${it.id}`;
        if (STOCK_CONSUMING.includes(status)) {
          if (await this.applyMovement(wh.id, it.variantId, 'SALE_OUT', -it.quantity, key, `Sipariş ${o.orderNumber ?? o.externalId}`)) stockOut += it.quantity;
        } else if (STOCK_RELEASING.includes(status)) {
          // Daha önce düşülmüşse geri ekle (yalnızca bir kez)
          const wasOut = await this.prisma.inventoryMovement.findUnique({ where: { referenceKey_type: { referenceKey: key, type: 'SALE_OUT' } } });
          if (wasOut && (await this.applyMovement(wh.id, it.variantId, 'RETURN_IN', it.quantity, key, `İptal/iade ${o.orderNumber ?? o.externalId}`))) stockIn += it.quantity;
        }
      }
    }
    return { created: !existing, stockOut, stockIn, variantIds };
  }

  /** Hareketi ve bakiyeyi tek işlemde yazar; aynı (referenceKey,type) varsa hiçbir şey yapmaz ve false döner. */
  private async applyMovement(warehouseId: string, variantId: string, type: 'SALE_OUT' | 'RETURN_IN', quantity: number, referenceKey: string, note: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.inventoryMovement.create({ data: { warehouseId, variantId, type, quantity, referenceKey, note } });
        await tx.inventoryBalance.upsert({
          where: { warehouseId_variantId: { warehouseId, variantId } },
          update: { onHand: { increment: quantity } },
          create: { warehouseId, variantId, onHand: quantity },
        });
      });
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return false; // benzersizlik ihlali = zaten işlenmiş
      throw e;
    }
  }

  // ---------------- Listeleme ----------------
  async list(user: JwtPayload, q: { accountId?: string; status?: string; q?: string; from?: string; to?: string; page: number; pageSize: number }) {
    const where: Prisma.OrderWhereInput = {
      organizationId: user.organizationId,
      channelAccountId: q.accountId,
      status: q.status as OrderStatus | undefined,
      orderedAt: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined },
      ...(q.q ? { OR: [{ orderNumber: { contains: q.q, mode: 'insensitive' } }, { externalId: { contains: q.q } }, { customerName: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: { channelAccount: { select: { label: true, channel: { select: { code: true, name: true } } } }, items: { select: { id: true, name: true, quantity: true, sku: true, variantId: true } }, shipments: true },
        orderBy: { orderedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize) };
  }

  async get(user: JwtPayload, id: string) {
    const o = await this.prisma.order.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { channelAccount: { select: { label: true, channel: { select: { code: true, name: true } } } }, items: { include: { variant: { select: { sku: true, costPrice: true, product: { select: { id: true, name: true } } } } } }, shipments: true, returns: true, history: { orderBy: { createdAt: 'asc' } } },
    });
    if (!o) throw new NotFoundException('Sipariş bulunamadı');
    // Sipariş bazında tahmini kâr: satış − komisyon − maliyet
    const cost = o.items.reduce((s, i) => s + Number(i.variant?.costPrice ?? 0) * i.quantity, 0);
    const commission = Number(o.commissionTotal ?? 0);
    return { ...o, profitEstimate: { revenue: Number(o.grandTotal), commission, cost, net: Number(o.grandTotal) - commission - cost } };
  }
}
