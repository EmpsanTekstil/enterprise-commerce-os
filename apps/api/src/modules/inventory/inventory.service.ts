import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v4 as uuid } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ---------- Depolar ----------
  warehouses(user: JwtPayload) {
    return this.prisma.warehouse.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], include: { _count: { select: { balances: true } } } });
  }

  async createWarehouse(user: JwtPayload, data: { name: string; code: string; address?: string; isDefault?: boolean }) {
    if (data.isDefault) await this.prisma.warehouse.updateMany({ where: { organizationId: user.organizationId }, data: { isDefault: false } });
    const w = await this.prisma.warehouse.create({ data: { organizationId: user.organizationId, name: data.name, code: data.code.toUpperCase(), address: data.address, isDefault: data.isDefault ?? false } });
    await this.audit.log(user, 'warehouse.create', 'Warehouse', w.id, null, data);
    return w;
  }

  // ---------- Bakiyeler ----------
  async balances(user: JwtPayload, q: { q?: string; warehouseId?: string; lowOnly?: boolean; page: number; pageSize: number }) {
    const where: Prisma.InventoryBalanceWhereInput = {
      warehouse: { organizationId: user.organizationId, id: q.warehouseId },
      ...(q.q ? { variant: { OR: [{ sku: { contains: q.q, mode: 'insensitive' } }, { barcode: { contains: q.q } }, { product: { name: { contains: q.q, mode: 'insensitive' } } }] } } : {}),
    };
    const rows = await this.prisma.inventoryBalance.findMany({
      where, include: { warehouse: { select: { id: true, name: true, code: true } }, variant: { select: { id: true, sku: true, barcode: true, color: true, size: true, product: { select: { id: true, name: true } }, listings: { select: { stockQuantity: true, status: true, channelAccount: { select: { label: true, channel: { select: { name: true } } } } } } } } },
      orderBy: { updatedAt: 'desc' },
    });
    const mapped = rows.map((b) => ({ ...b, available: b.onHand - b.reserved, isLow: b.onHand - b.reserved <= b.reorderPoint }));
    const filtered = q.lowOnly ? mapped.filter((b) => b.isLow) : mapped;
    const total = filtered.length;
    return { items: filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize) };
  }

  /** Elle stok düzeltme: mutlak değer veya fark; hareket defterine yazılır. */
  async adjust(user: JwtPayload, data: { variantId: string; warehouseId: string; quantity?: number; delta?: number; reorderPoint?: number; note?: string }) {
    const [variant, wh] = await Promise.all([
      this.prisma.productVariant.findFirst({ where: { id: data.variantId, product: { organizationId: user.organizationId } } }),
      this.prisma.warehouse.findFirst({ where: { id: data.warehouseId, organizationId: user.organizationId } }),
    ]);
    if (!variant || !wh) throw new NotFoundException('Varyant veya depo bulunamadı');
    if (data.quantity == null && data.delta == null && data.reorderPoint == null) throw new BadRequestException('quantity, delta veya reorderPoint verilmeli');
    const result = await this.prisma.$transaction(async (tx) => {
      const bal = await tx.inventoryBalance.upsert({ where: { warehouseId_variantId: { warehouseId: wh.id, variantId: variant.id } }, update: {}, create: { warehouseId: wh.id, variantId: variant.id, onHand: 0 } });
      const diff = data.quantity != null ? data.quantity - bal.onHand : data.delta ?? 0;
      if (diff !== 0) {
        await tx.inventoryMovement.create({ data: { warehouseId: wh.id, variantId: variant.id, type: 'ADJUSTMENT', quantity: diff, referenceKey: `manual:${uuid()}`, note: data.note ?? `Elle düzeltme (${bal.onHand} → ${bal.onHand + diff})`, createdById: user.sub } });
      }
      return tx.inventoryBalance.update({ where: { id: bal.id }, data: { onHand: { increment: diff }, reorderPoint: data.reorderPoint ?? undefined } });
    });
    await this.audit.log(user, 'inventory.adjust', 'InventoryBalance', result.id, null, data);
    return { ...result, available: result.onHand - result.reserved };
  }

  movements(user: JwtPayload, variantId: string, take = 100) {
    return this.prisma.inventoryMovement.findMany({ where: { variantId, variant: { product: { organizationId: user.organizationId } } }, include: { warehouse: { select: { name: true, code: true } } }, orderBy: { createdAt: 'desc' }, take });
  }

  // ---------- Kanal stok politikası ----------
  async setPolicy(user: JwtPayload, accountId: string, data: { sharePercent?: number; bufferQuantity?: number; maxQuantity?: number | null; autoPush?: boolean }) {
    const acc = await this.prisma.channelAccount.findFirst({ where: { id: accountId, organizationId: user.organizationId } });
    if (!acc) throw new NotFoundException('Kanal hesabı bulunamadı');
    const p = await this.prisma.channelStockPolicy.upsert({ where: { channelAccountId: accountId }, update: data, create: { channelAccountId: accountId, ...data, maxQuantity: data.maxQuantity ?? undefined } });
    await this.audit.log(user, 'inventory.policy', 'ChannelStockPolicy', p.id, null, data);
    return p;
  }

  policies(user: JwtPayload) {
    return this.prisma.channelStockPolicy.findMany({ where: { channelAccount: { organizationId: user.organizationId } }, include: { channelAccount: { select: { id: true, label: true, channel: { select: { name: true } } } } } });
  }

  /** Mutabakat: merkezi satılabilir stok ile kanalda bilinen son stok farkı. */
  async reconciliation(user: JwtPayload) {
    const listings = await this.prisma.listing.findMany({
      where: { channelAccount: { organizationId: user.organizationId }, variantId: { not: null }, status: { in: ['ACTIVE', 'PAUSED'] } },
      include: { variant: { include: { balances: true, product: { select: { name: true } } } }, channelAccount: { select: { label: true, channel: { select: { name: true } }, stockPolicies: true } } },
    });
    const diffs = listings.map((l) => {
      const available = l.variant!.balances.reduce((s, b) => s + b.onHand - b.reserved, 0);
      const pol = l.channelAccount.stockPolicies[0];
      let expected = Math.max(0, available - (pol?.bufferQuantity ?? 0)); expected = Math.floor((expected * (pol?.sharePercent ?? 100)) / 100);
      if (pol?.maxQuantity != null) expected = Math.min(expected, pol.maxQuantity);
      return { listingId: l.id, sku: l.variant!.sku, product: l.variant!.product.name, channel: `${l.channelAccount.channel.name} · ${l.channelAccount.label}`, expected, channelStock: l.stockQuantity, diff: l.stockQuantity == null ? null : expected - l.stockQuantity, lastSyncedAt: l.lastSyncedAt };
    }).filter((d) => d.diff !== 0);
    return { mismatches: diffs.length, items: diffs.slice(0, 500) };
  }
}
