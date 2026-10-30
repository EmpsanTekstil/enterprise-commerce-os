import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChannelAccount, Prisma } from '@prisma/client';
import { AdapterContext, ChannelAdapter, ChannelAttributeDef, ExternalProduct, PushResult, UnsupportedOperationError } from '../../integrations/adapter.interface';
import { AdapterRegistry } from '../../integrations/adapter.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';
import { ChannelsService } from '../channels/channels.service';

type Account = ChannelAccount & { channel: { code: string } };

/** CategoryMapping.attributeMapJson biçimi: { [kanalÖzellikId]: kural } */
export interface AttributeRule {
  valueId?: string;        // sabit kanal değeri
  customValue?: string;    // sabit serbest metin (allowCustom gerekir)
  source?: 'color' | 'size' | 'material' | 'spec' | 'brand' | 'model'; // üründen oku
  specKey?: string;        // source=spec ise teknik özellik adı
}

export interface PreparedListing {
  variantId: string;
  sku: string;
  product?: ExternalProduct;
  problems: string[];   // boşsa gönderilebilir
  warnings: string[];
}

const COLOR_NAMES = ['renk', 'color', 'colour'];
const SIZE_NAMES = ['beden', 'size', 'numara', 'ölçü', 'olcu'];
const MATERIAL_NAMES = ['materyal', 'malzeme', 'material', 'kumaş', 'kumas'];
const COUNTRY_ISO: Record<string, string> = { türkiye: 'TR', turkiye: 'TR', turkey: 'TR', çin: 'CN', cin: 'CN', china: 'CN', almanya: 'DE', italya: 'IT', abd: 'US', vietnam: 'VN', bangladeş: 'BD', hindistan: 'IN' };

@Injectable()
export class PublishService {
  constructor(private prisma: PrismaService, private audit: AuditService, private channels: ChannelsService, private registry: AdapterRegistry) {}

  /** Gönderim yapmadan kontrol: her varyant için eksikler ve oluşacak kanal ürünü. */
  async prepare(user: JwtPayload, accountId: string, variantIds: string[]): Promise<PreparedListing[]> {
    const account = await this.channels.getOwned(user, accountId);
    const adapter = this.registry.get(account.channel.code);
    const ctx = this.channels.buildContext(account);
    const out: PreparedListing[] = [];
    for (const variantId of variantIds) out.push(await this.prepareOne(user, account, adapter, ctx, variantId));
    return out;
  }

  /** Hazır olanları kanala gönderir; eksik olanlar ERROR olarak işaretlenir, gönderilmez. */
  async publish(user: JwtPayload, accountId: string, variantIds: string[]) {
    const account = await this.channels.getOwned(user, accountId);
    const adapter = this.registry.get(account.channel.code);
    if (!adapter.createProducts) throw new UnsupportedOperationError(adapter.displayName, 'products.create');
    const ctx = this.channels.buildContext(account);
    const prepared = await Promise.all(variantIds.map((v) => this.prepareOne(user, account, adapter, ctx, v)));
    const ready = prepared.filter((p) => p.problems.length === 0 && p.product);
    const blocked = prepared.filter((p) => p.problems.length > 0);

    for (const b of blocked) {
      await this.prisma.listing.upsert({
        where: { channelAccountId_variantId: { channelAccountId: accountId, variantId: b.variantId } },
        update: { status: 'ERROR', lastError: `Gönderilmedi: ${b.problems.join('; ')}` },
        create: { channelAccountId: accountId, variantId: b.variantId, status: 'ERROR', lastError: `Gönderilmedi: ${b.problems.join('; ')}` },
      });
    }
    let sent = 0, failed = 0; let batchRequestId: string | undefined;
    if (ready.length) {
      const results = await adapter.createProducts(ctx, ready.map((r) => r.product!));
      for (let i = 0; i < ready.length; i++) {
        const r = results[i]; const p = ready[i];
        if (r?.ok) { sent++; batchRequestId = r.batchRequestId; } else failed++;
        await this.prisma.listing.upsert({
          where: { channelAccountId_variantId: { channelAccountId: accountId, variantId: p.variantId } },
          update: {
            externalId: p.product!.barcode, externalSku: p.sku, title: p.product!.title, status: r?.ok ? 'PENDING' : 'ERROR',
            lastError: r?.ok ? null : r?.error ?? 'bilinmeyen hata', batchRequestId: r?.batchRequestId, publishedAt: r?.ok ? new Date() : undefined,
            price: p.product!.price, salePrice: p.product!.salePrice, attributesJson: (p.product!.channelAttributes ?? []) as unknown as Prisma.InputJsonValue,
          },
          create: {
            channelAccountId: accountId, variantId: p.variantId, externalId: p.product!.barcode, externalSku: p.sku, title: p.product!.title,
            status: r?.ok ? 'PENDING' : 'ERROR', lastError: r?.ok ? null : r?.error ?? 'bilinmeyen hata', batchRequestId: r?.batchRequestId,
            publishedAt: r?.ok ? new Date() : undefined, price: p.product!.price, salePrice: p.product!.salePrice,
            attributesJson: (p.product!.channelAttributes ?? []) as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }
    await this.audit.log(user, 'listing.publish', 'ChannelAccount', accountId, null, { requested: variantIds.length, sent, failed, blocked: blocked.length, batchRequestId });
    return { requested: variantIds.length, sent, failed, blocked: blocked.map((b) => ({ sku: b.sku, problems: b.problems })), batchRequestId };
  }

  /** Toplu işlem sonuçlarını sorgular (senkron işi BATCH_CHECK): PENDING ilanlar (yayın/içerik) + fiyat/stok gönderimi bekleyen ilanlar. */
  async checkBatches(account: Account, adapter: ChannelAdapter, ctx: AdapterContext) {
    if (!adapter.checkBatch) return { checked: 0 };
    const pending = await this.prisma.listing.findMany({ where: { channelAccountId: account.id, batchRequestId: { not: null } } });
    const byBatch = new Map<string, typeof pending>();
    for (const l of pending) byBatch.set(l.batchRequestId!, [...(byBatch.get(l.batchRequestId!) ?? []), l]);
    let approved = 0, rejected = 0, stillPending = 0;
    for (const [batchId, listings] of byBatch) {
      const st = await adapter.checkBatch(ctx, batchId);
      if (!st.done) { stillPending += listings.length; continue; }
      for (const l of listings) {
        const item = st.items.find((i) => i.externalId === l.externalId);
        if (!item) { stillPending++; continue; }
        const publishFlow = l.status === 'PENDING'; // fiyat/stok gönderiminde durum değişmez, yalnızca hata/temizlik
        if (item.ok) { approved++; await this.prisma.listing.update({ where: { id: l.id }, data: { ...(publishFlow ? { status: 'ACTIVE' } : {}), batchRequestId: null, lastError: null, lastSyncedAt: new Date() } }); }
        else { rejected++; await this.prisma.listing.update({ where: { id: l.id }, data: { ...(publishFlow ? { status: 'REJECTED' } : {}), batchRequestId: null, lastError: item.errors.join('; ') || 'Kanal reddetti' } }); }
      }
    }
    return { checked: pending.length, approved, rejected, stillPending };
  }

  // ---------------- hazırlık ----------------
  private async prepareOne(user: JwtPayload, account: Account, adapter: ChannelAdapter, ctx: AdapterContext, variantId: string): Promise<PreparedListing> {
    const v = await this.prisma.productVariant.findFirst({
      where: { id: variantId, product: { organizationId: user.organizationId } },
      include: { product: { include: { images: { orderBy: { sortOrder: 'asc' } }, category: true } }, images: { orderBy: { sortOrder: 'asc' } }, balances: true, listings: { where: { channelAccountId: account.id } } },
    });
    if (!v) throw new NotFoundException(`Varyant bulunamadı: ${variantId}`);
    const problems: string[] = []; const warnings: string[] = [];
    const p = v.product; const listing = v.listings[0];
    const title = (listing?.title ?? p.name).trim();
    const description = listing?.description ?? p.description ?? '';
    if (!v.barcode) problems.push('Barkod yok');
    if (!title) problems.push('Başlık yok'); else if (title.length > 100) warnings.push('Başlık 100 karaktere kısaltılacak');
    if (!description || description.length < 30) problems.push('Açıklama en az 30 karakter olmalı');
    const price = listing?.price != null ? Number(listing.price) : v.listPrice != null ? Number(v.listPrice) : undefined;
    if (price == null || price <= 0) problems.push('Satış fiyatı yok');
    const salePrice = listing?.salePrice != null ? Number(listing.salePrice) : price;
    if (price != null && salePrice != null && salePrice > price) problems.push('İndirimli fiyat liste fiyatından büyük olamaz');

    // Görseller
    const imgs = [...v.images, ...p.images.filter((i) => !i.variantId)];
    let urls = imgs.map((i) => i.url);
    if (listing?.imageOrder && Array.isArray(listing.imageOrder)) {
      const order = listing.imageOrder as string[];
      urls = [...imgs].sort((a, b) => (order.indexOf(a.id) === -1 ? 999 : order.indexOf(a.id)) - (order.indexOf(b.id) === -1 ? 999 : order.indexOf(b.id))).map((i) => i.url);
    }
    if (urls.length === 0) problems.push('En az 1 görsel gerekli');
    else if (account.channel.code !== 'mock' && urls.some((u) => !u.startsWith('https://'))) problems.push('Görsel adresleri herkese açık HTTPS olmalı (yerel depolama kanala gönderilemez; S3/MinIO + genel URL gerekir)');

    // Marka
    let brandExternalId: string | undefined;
    if (!p.brand) problems.push('Marka yok');
    else {
      brandExternalId = await this.resolveBrand(account, adapter, ctx, p.brand);
      if (!brandExternalId) problems.push(`Marka kanalda bulunamadı: "${p.brand}" (kanal marka adıyla birebir eşleşmeli)`);
    }

    // Kategori + özellikler
    let categoryExternalId: string | undefined;
    const channelAttributes: ExternalProduct['channelAttributes'] = [];
    if (!p.categoryId) problems.push('Ürün kategorisi yok');
    else {
      const mapping = await this.prisma.categoryMapping.findUnique({ where: { categoryId_channelAccountId: { categoryId: p.categoryId, channelAccountId: account.id } }, include: { channelCategory: true } });
      if (!mapping) problems.push(`Kategori eşleştirilmemiş: ${p.category?.path}`);
      else {
        categoryExternalId = mapping.channelCategory.externalId;
        let defs = (mapping.channelCategory.attributesJson as unknown as ChannelAttributeDef[] | null) ?? null;
        if (!defs && adapter.fetchCategoryAttributes) {
          defs = await adapter.fetchCategoryAttributes(ctx, categoryExternalId);
          await this.prisma.channelCategory.update({ where: { id: mapping.channelCategory.id }, data: { attributesJson: defs as unknown as Prisma.InputJsonValue } });
        }
        const rules = (mapping.attributeMapJson ?? {}) as Record<string, AttributeRule>;
        const specs = (p.specsJson ?? {}) as Record<string, string>;
        for (const def of defs ?? []) {
          const resolved = this.resolveAttribute(def, rules[def.id], { color: v.color, size: v.size, material: v.material, brand: p.brand, model: p.model, specs });
          if (resolved) channelAttributes.push(resolved);
          else if (def.required) problems.push(`Zorunlu özellik eksik: ${def.name}` + (def.allowCustom ? '' : ' (kanal listesinden bir değer seçilmeli)'));
        }
      }
    }

    const stock = v.balances.reduce((s, b) => s + b.onHand - b.reserved, 0);
    const originKey = (p.originCountry ?? '').toLowerCase().trim();
    const product: ExternalProduct = {
      externalId: v.barcode ?? v.sku, barcode: v.barcode ?? undefined, sku: v.sku, title: title.slice(0, 100), description, brand: p.brand ?? undefined, brandExternalId,
      groupId: (p.model || p.id).slice(0, 40), categoryExternalId, price, salePrice, stock: Math.max(0, stock), vatRate: Number(p.vatRate),
      weightGrams: v.weightGrams ?? undefined, originCountryCode: COUNTRY_ISO[originKey] ?? (originKey.length === 2 ? originKey.toUpperCase() : undefined),
      images: urls, channelAttributes, attributes: (p.specsJson ?? {}) as Record<string, string>, raw: null,
    };
    return { variantId, sku: v.sku, product: problems.length ? undefined : product, problems, warnings };
  }

  private resolveAttribute(def: ChannelAttributeDef, rule: AttributeRule | undefined, src: { color: string | null; size: string | null; material: string | null; brand: string | null; model: string | null; specs: Record<string, string> }) {
    if (rule?.valueId) return { attributeId: def.id, valueId: rule.valueId };
    if (rule?.customValue && def.allowCustom) return { attributeId: def.id, customValue: rule.customValue };
    let text: string | null | undefined;
    const n = def.name.toLowerCase();
    if (rule?.source === 'color' || (!rule && COLOR_NAMES.includes(n))) text = src.color;
    else if (rule?.source === 'size' || (!rule && SIZE_NAMES.includes(n))) text = src.size;
    else if (rule?.source === 'material' || (!rule && MATERIAL_NAMES.includes(n))) text = src.material ?? src.specs['Malzeme'] ?? src.specs['Materyal'];
    else if (rule?.source === 'brand') text = src.brand;
    else if (rule?.source === 'model') text = src.model;
    else if (rule?.source === 'spec' && rule.specKey) text = src.specs[rule.specKey];
    else if (!rule) text = src.specs[def.name] ?? Object.entries(src.specs).find(([k]) => k.toLowerCase() === n)?.[1];
    if (!text) return null;
    const match = def.values?.find((x) => x.name.toLowerCase() === text!.toLowerCase());
    if (match) return { attributeId: def.id, valueId: match.id };
    if (def.allowCustom) return { attributeId: def.id, customValue: text };
    return null; // listeden seçilmesi gereken ama eşleşmeyen değer
  }

  private async resolveBrand(account: Account, adapter: ChannelAdapter, ctx: AdapterContext, name: string) {
    const cached = await this.prisma.channelBrand.findFirst({ where: { channelAccountId: account.id, name: { equals: name, mode: 'insensitive' } } });
    if (cached) return cached.externalId;
    if (!adapter.findBrands) return undefined;
    const found = await adapter.findBrands(ctx, name);
    const exact = found.find((b) => b.name.toLowerCase() === name.toLowerCase());
    for (const b of found.slice(0, 50)) {
      await this.prisma.channelBrand.upsert({ where: { channelAccountId_externalId: { channelAccountId: account.id, externalId: b.externalId } }, update: { name: b.name }, create: { channelAccountId: account.id, externalId: b.externalId, name: b.name } });
    }
    return exact?.externalId;
  }

  // ---------------- ilan düzenleme ----------------
  /**
   * Kanal-özel ilan düzenlemesi. Yerelde kaydeder ve ilan kanalda yayındaysa değişikliği ANINDA kanala gönderir:
   * fiyat → updateStockAndPrice (Trendyol'da dakikalar içinde), başlık/açıklama → updateProducts (Trendyol onayından sonra yayınlanır).
   */
  async updateListing(user: JwtPayload, listingId: string, data: { title?: string; description?: string; price?: number; salePrice?: number; imageOrder?: string[] }) {
    const l = await this.prisma.listing.findFirst({ where: { id: listingId, channelAccount: { organizationId: user.organizationId } }, include: { channelAccount: { include: { channel: true } }, variant: true } });
    if (!l) throw new NotFoundException('İlan bulunamadı');
    if (data.title && data.title.length > 100) throw new BadRequestException('Başlık en fazla 100 karakter');
    if ((data.price != null && data.price <= 0) || (data.salePrice != null && data.salePrice <= 0)) throw new BadRequestException('Fiyat 0 veya negatif olamaz');
    const price = data.price ?? (Number(l.price) || undefined);
    const salePrice = data.salePrice ?? (data.price != null ? data.price : Number(l.salePrice) || undefined);
    if (price != null && salePrice != null && salePrice > price) throw new BadRequestException('İndirimli fiyat liste fiyatından büyük olamaz');
    const live = !!l.externalId && l.status !== 'DRAFT';
    const adapter = this.registry.get(l.channelAccount.channel.code);
    const raw = (l.rawSnapshot ?? {}) as Record<string, unknown>;
    const contentChanged = data.title != null || data.description != null || data.imageOrder != null;
    const updated = await this.prisma.listing.update({ where: { id: listingId }, data: { ...data, imageOrder: data.imageOrder as Prisma.InputJsonValue | undefined } });
    await this.audit.log(user, 'listing.update', 'Listing', listingId, { title: l.title, price: l.price }, data);
    const pushed: { price?: PushResult; content?: PushResult } = {};
    if (!live) return { ...updated, pushed };

    const ctx = this.channels.buildContext(l.channelAccount);
    const barcode = l.variant?.barcode ?? l.externalId!;
    if ((data.price != null || data.salePrice != null) && price != null) {
      pushed.price = adapter.updateStockAndPrice
        ? (await adapter.updateStockAndPrice(ctx, [{ barcode, price, salePrice: salePrice ?? price }]))[0]
        : { ok: false, error: `${adapter.displayName} fiyat güncellemeyi API ile desteklemiyor` };
    }
    if (contentChanged) {
      if (!adapter.updateProducts) pushed.content = { ok: false, error: `${adapter.displayName} başlık/açıklama güncellemeyi API ile desteklemiyor; yeniden yayınlayın` };
      else {
        const attrs = (raw.channelAttributes ?? []) as { attributeId?: number; attributeValueId?: number; attributeValue?: string }[];
        const product: ExternalProduct = {
          externalId: l.externalId!, barcode, sku: updated.externalSku ?? (raw.stockCode as string | undefined) ?? undefined,
          title: updated.title ?? '', description: updated.description ?? (raw.description as string | undefined),
          groupId: raw.productMainId as string | undefined, brandExternalId: raw.brandId != null ? String(raw.brandId) : undefined, categoryExternalId: raw.categoryId != null ? String(raw.categoryId) : undefined,
          vatRate: raw.vatRate as number | undefined, originCountryCode: raw.origin as string | undefined,
          weightGrams: raw.dimensionalWeight ? Number(raw.dimensionalWeight) * 1000 : undefined,
          images: raw.images as string[] | undefined,
          channelAttributes: attrs.filter((a) => a.attributeId).map((a) => ({ attributeId: String(a.attributeId), ...(a.attributeValueId ? { valueId: String(a.attributeValueId) } : { customValue: a.attributeValue ?? '' }) })),
          raw,
        };
        pushed.content = (await adapter.updateProducts(ctx, [product]))[0];
      }
    }
    const errors = [pushed.price, pushed.content].filter((r) => r && !r.ok).map((r) => r!.error).join('; ');
    const batchRequestId = pushed.content?.batchRequestId ?? pushed.price?.batchRequestId;
    const after = await this.prisma.listing.update({
      where: { id: listingId },
      data: { lastError: errors || null, ...(batchRequestId ? { batchRequestId } : {}), ...(pushed.content?.ok ? { status: 'PENDING' } : {}) },
    });
    await this.audit.log(user, 'listing.push', 'Listing', listingId, null, pushed as unknown as Prisma.InputJsonValue);
    return { ...after, pushed };
  }
}
