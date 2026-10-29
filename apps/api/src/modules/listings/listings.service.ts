import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChannelAccount, Prisma } from '@prisma/client';
import { AdapterContext, ChannelAdapter, ExternalProduct, UnsupportedOperationError } from '../../integrations/adapter.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';

type Account = ChannelAccount & { channel: { code: string } };

@Injectable()
export class ListingsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ---------------- Kategori çekme ----------------
  async pullCategories(account: Account, adapter: ChannelAdapter, ctx: AdapterContext) {
    if (!adapter.fetchCategories) throw new UnsupportedOperationError(adapter.displayName, 'categories.read');
    const cats = await adapter.fetchCategories(ctx);
    const pathById = new Map<string, string>();
    const byId = new Map(cats.map((c) => [c.externalId, c]));
    const pathOf = (id: string): string => {
      if (pathById.has(id)) return pathById.get(id)!;
      const c = byId.get(id)!;
      const p = c.parentExternalId && byId.has(c.parentExternalId) ? `${pathOf(c.parentExternalId)} > ${c.name}` : c.name;
      pathById.set(id, p);
      return p;
    };
    let n = 0;
    for (const batch of chunk(cats, 500)) {
      await this.prisma.$transaction(
        batch.map((c) =>
          this.prisma.channelCategory.upsert({
            where: { channelAccountId_externalId: { channelAccountId: account.id, externalId: c.externalId } },
            update: { name: c.name, parentExternalId: c.parentExternalId, isLeaf: c.isLeaf, path: pathOf(c.externalId), fetchedAt: new Date() },
            create: { channelAccountId: account.id, externalId: c.externalId, name: c.name, parentExternalId: c.parentExternalId, isLeaf: c.isLeaf, path: pathOf(c.externalId) },
          }),
        ),
      );
      n += batch.length;
    }
    return { categories: n };
  }

  // ---------------- Ürün içe aktarma ----------------
  /**
   * Kanaldaki ürünleri Listing olarak kaydeder. Merkezi ürünle OTOMATİK birleştirme yapmaz;
   * barkod/SKU eşleşmelerini ListingMatchSuggestion olarak önerir, kullanıcı onaylar.
   * Daha önce eşleştirilmiş ilanlar korunur (variantId değişmez).
   */
  async pullProducts(account: Account, adapter: ChannelAdapter, ctx: AdapterContext) {
    if (!adapter.fetchProducts) throw new UnsupportedOperationError(adapter.displayName, 'products.read');
    let cursor: string | undefined;
    let imported = 0, suggested = 0, pages = 0;
    do {
      const page = await adapter.fetchProducts(ctx, cursor);
      pages++;
      for (const p of page.items) {
        const listing = await this.prisma.listing.upsert({
          where: { channelAccountId_externalId: { channelAccountId: account.id, externalId: p.externalId } },
          update: {
            externalSku: p.sku, title: p.title, description: p.description, price: p.price, salePrice: p.salePrice,
            stockQuantity: p.stock, attributesJson: (p.attributes ?? {}) as Prisma.InputJsonValue, rawSnapshot: p.raw as Prisma.InputJsonValue,
            lastSyncedAt: new Date(), status: this.statusOf(p),
          },
          create: {
            channelAccountId: account.id, externalId: p.externalId, externalSku: p.sku, title: p.title, description: p.description,
            price: p.price, salePrice: p.salePrice, stockQuantity: p.stock, attributesJson: (p.attributes ?? {}) as Prisma.InputJsonValue,
            rawSnapshot: p.raw as Prisma.InputJsonValue, lastSyncedAt: new Date(), status: 'UNLINKED',
          },
        });
        imported++;
        if (!listing.variantId) suggested += await this.suggestMatches(account.organizationId, listing.id, p);
      }
      cursor = page.nextCursor;
    } while (cursor && pages < 500);
    return { imported, suggestions: suggested, pages };
  }

  private statusOf(p: ExternalProduct) {
    switch (p.status) {
      case 'active': return 'ACTIVE' as const;
      case 'paused': return 'PAUSED' as const;
      case 'pending': return 'PENDING' as const;
      case 'archived': return 'PAUSED' as const;
      default: return undefined;
    }
  }

  private async suggestMatches(organizationId: string, listingId: string, p: ExternalProduct) {
    const candidates: { variantId: string; confidence: number; reason: string }[] = [];
    if (p.barcode) {
      const v = await this.prisma.productVariant.findMany({ where: { barcode: p.barcode, product: { organizationId } }, select: { id: true } });
      for (const x of v) candidates.push({ variantId: x.id, confidence: 95, reason: 'Barkod eşleşti' });
    }
    if (p.sku) {
      const v = await this.prisma.productVariant.findMany({ where: { sku: p.sku, product: { organizationId } }, select: { id: true } });
      for (const x of v) if (!candidates.some((c) => c.variantId === x.id)) candidates.push({ variantId: x.id, confidence: 80, reason: 'SKU eşleşti' });
    }
    for (const c of candidates) {
      await this.prisma.listingMatchSuggestion.upsert({
        where: { listingId_variantId: { listingId, variantId: c.variantId } },
        update: { confidence: c.confidence, reason: c.reason },
        create: { listingId, variantId: c.variantId, confidence: c.confidence, reason: c.reason },
      });
    }
    return candidates.length;
  }

  // ---------------- Eşleştirme işlemleri ----------------
  async link(user: JwtPayload, listingId: string, variantId: string) {
    const listing = await this.getOwned(user, listingId);
    const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, product: { organizationId: user.organizationId } } });
    if (!variant) throw new NotFoundException('Varyant bulunamadı');
    const clash = await this.prisma.listing.findFirst({ where: { channelAccountId: listing.channelAccountId, variantId, id: { not: listingId } } });
    if (clash) throw new BadRequestException('Bu varyant aynı kanal hesabında başka bir ilana bağlı');
    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: { variantId, status: listing.status === 'UNLINKED' ? 'ACTIVE' : listing.status },
    });
    await this.prisma.listingMatchSuggestion.deleteMany({ where: { listingId } });
    await this.audit.log(user, 'listing.link', 'Listing', listingId, { variantId: listing.variantId }, { variantId });
    return updated;
  }

  /** Güven eşiği üzerindeki (varsayılan 95 = barkod) ve tek adaylı önerileri topluca kabul eder. */
  async acceptSuggestions(user: JwtPayload, accountId: string, minConfidence = 95) {
    const listings = await this.prisma.listing.findMany({
      where: { channelAccountId: accountId, channelAccount: { organizationId: user.organizationId }, variantId: null },
      include: { matchSuggestions: true },
    });
    let linked = 0, skipped = 0;
    for (const l of listings) {
      const good = l.matchSuggestions.filter((s) => Number(s.confidence) >= minConfidence);
      if (good.length === 1) {
        try { await this.link(user, l.id, good[0].variantId); linked++; } catch { skipped++; }
      } else if (good.length > 1) skipped++; // çakışma: kullanıcı karar verir
    }
    return { linked, skipped };
  }

  /** Kanalda olup merkezde olmayan bir ilandan merkezi ürün + varyant oluşturur ve bağlar. */
  async createProductFromListing(user: JwtPayload, listingId: string) {
    const l = await this.getOwned(user, listingId);
    if (l.variantId) throw new BadRequestException('İlan zaten bir ürüne bağlı');
    const raw = (l.rawSnapshot ?? {}) as Record<string, unknown>;
    const barcode = l.externalId;
    const sku = l.externalSku || `IMP-${l.externalId}`;
    const existingSku = await this.prisma.productVariant.findFirst({ where: { sku, product: { organizationId: user.organizationId } } });
    if (existingSku) throw new BadRequestException(`SKU zaten var: ${sku}. Önce eşleştirme önerisini kullanın.`);
    const product = await this.prisma.product.create({
      data: {
        organizationId: user.organizationId,
        name: l.title ?? sku,
        brand: typeof raw.brand === 'string' ? raw.brand : undefined,
        description: l.description,
        specsJson: (l.attributesJson ?? {}) as Prisma.InputJsonValue,
        status: 'ACTIVE',
        variants: { create: [{ sku, barcode, listPrice: l.price ?? undefined }] },
      },
      include: { variants: true },
    });
    const wh = await this.prisma.warehouse.findFirst({ where: { organizationId: user.organizationId, isDefault: true } });
    if (wh) {
      await this.prisma.inventoryBalance.create({ data: { warehouseId: wh.id, variantId: product.variants[0].id, onHand: l.stockQuantity ?? 0 } });
      if (l.stockQuantity) {
        await this.prisma.inventoryMovement.create({
          data: { warehouseId: wh.id, variantId: product.variants[0].id, type: 'ADJUSTMENT', quantity: l.stockQuantity, referenceKey: `import:${l.id}`, note: 'Kanaldan içe aktarılan açılış stoğu', createdById: user.sub },
        });
      }
    }
    await this.link(user, listingId, product.variants[0].id);
    await this.audit.log(user, 'product.create_from_listing', 'Product', product.id, null, { listingId });
    return product;
  }

  // ---------------- Stok / fiyat gönderme ----------------
  /**
   * Belirli varyantların (veya hesaptaki tüm bağlı ilanların) satılabilir stoğunu ve fiyatını kanala gönderir.
   * Satılabilir = Σ(onHand - reserved); ChannelStockPolicy ile pay/tampon/üst sınır uygulanır.
   */
  async pushStockAndPrice(account: Account, adapter: ChannelAdapter, ctx: AdapterContext, variantIds?: string[]) {
    if (!adapter.updateStockAndPrice) throw new UnsupportedOperationError(adapter.displayName, 'stock.update');
    const policy = await this.prisma.channelStockPolicy.findUnique({ where: { channelAccountId: account.id } });
    const listings = await this.prisma.listing.findMany({
      where: { channelAccountId: account.id, variantId: variantIds ? { in: variantIds } : { not: null }, externalId: { not: null } },
      include: { variant: { include: { balances: true } } },
    });
    const items = listings.map((l) => {
      const available = l.variant!.balances.reduce((s, b) => s + b.onHand - b.reserved, 0);
      let qty = Math.max(0, available - (policy?.bufferQuantity ?? 0));
      qty = Math.floor((qty * (policy?.sharePercent ?? 100)) / 100);
      if (policy?.maxQuantity != null) qty = Math.min(qty, policy.maxQuantity);
      const price = l.price != null ? Number(l.price) : l.variant!.listPrice != null ? Number(l.variant!.listPrice) : undefined;
      return { listingId: l.id, externalId: l.externalId!, barcode: l.variant!.barcode ?? l.externalId!, sku: l.variant!.sku, stock: qty, price, salePrice: l.salePrice != null ? Number(l.salePrice) : undefined };
    });
    if (items.length === 0) return { pushed: 0 };
    const results = await adapter.updateStockAndPrice(ctx, items);
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      const r = results[i];
      if (r?.ok) ok++;
      await this.prisma.listing.update({
        where: { id: items[i].listingId },
        data: { stockQuantity: r?.ok ? items[i].stock : undefined, lastSyncedAt: r?.ok ? new Date() : undefined, lastError: r?.ok ? null : r?.error ?? 'bilinmeyen hata', status: r?.ok ? undefined : 'ERROR' },
      });
    }
    return { pushed: ok, failed: items.length - ok, batchRequestId: results[0]?.batchRequestId };
  }

  // ---------------- Listeleme ----------------
  async list(user: JwtPayload, q: { accountId?: string; status?: string; q?: string; page: number; pageSize: number }) {
    const where: Prisma.ListingWhereInput = {
      channelAccount: { organizationId: user.organizationId, id: q.accountId },
      status: q.status as never,
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { externalSku: { contains: q.q, mode: 'insensitive' } }, { externalId: { contains: q.q } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        include: {
          channelAccount: { select: { id: true, label: true, channel: { select: { code: true, name: true } } } },
          variant: { select: { id: true, sku: true, barcode: true, product: { select: { id: true, name: true } } } },
          matchSuggestions: { include: {} , orderBy: { confidence: 'desc' } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      }),
      this.prisma.listing.count({ where }),
    ]);
    // Öneri adaylarının SKU/ad bilgisini ekle
    const variantIds = [...new Set(items.flatMap((l) => l.matchSuggestions.map((s) => s.variantId)))];
    const variants = variantIds.length ? await this.prisma.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, sku: true, barcode: true, product: { select: { name: true } } } }) : [];
    const vmap = new Map(variants.map((v) => [v.id, v]));
    return {
      items: items.map((l) => ({ ...l, matchSuggestions: l.matchSuggestions.map((s) => ({ ...s, variant: vmap.get(s.variantId) ?? null })) })),
      total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize),
    };
  }

  private async getOwned(user: JwtPayload, id: string) {
    const l = await this.prisma.listing.findFirst({ where: { id, channelAccount: { organizationId: user.organizationId } } });
    if (!l) throw new NotFoundException('İlan bulunamadı');
    return l;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
