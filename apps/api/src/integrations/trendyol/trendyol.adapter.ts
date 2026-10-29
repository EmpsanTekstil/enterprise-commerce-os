import {
  AdapterContext, BatchStatus, CapabilityMatrix, ChannelAdapter, ChannelAttributeDef, ExternalBrand, ExternalCategory, ExternalOrder,
  ExternalProduct, ExternalQuestion, ExternalReturn, PagedResult, PushResult, UnsupportedOperationError,
} from '../adapter.interface';
import { HttpError, httpRequest } from '../http-client';

/**
 * TRENDYOL ADAPTÖRÜ
 * Resmî doküman: https://developers.trendyol.com
 * Kimlik: Basic Auth (apiKey:apiSecret) + "User-Agent: {supplierId} - SelfIntegration"
 * Gerekli credentials alanları: supplierId, apiKey, apiSecret
 *
 * Uç noktalar Product V2 / Order V2 (V1 servisleri 15 Ekim 2026'da kapatıldı).
 * Ayrıntı ve doküman bağlantıları: docs/04-KANAL-API-YETENEK-MATRISI.md
 * Burada "status: planned" olan işlemler henüz kodlanmadı; çağrılırsa hata fırlatır.
 */
export class TrendyolAdapter implements ChannelAdapter {
  readonly code = 'trendyol';
  readonly displayName = 'Trendyol';
  readonly baseUrl = process.env.TRENDYOL_BASE_URL ?? 'https://apigw.trendyol.com/integration';

  readonly capabilities: CapabilityMatrix = {
    'products.read':   { status: 'supported', docUrl: 'https://developers.trendyol.com/v2.0/docs/product-v2-api-endpoint', note: 'Onaylı/onaysız ürün filtreleme V2' },
    'products.create': { status: 'supported', docUrl: 'https://developers.trendyol.com/v2.0/docs/product-create-v2', note: 'POST .../sellers/{id}/v2/products, asenkron batch' },
    'products.update': { status: 'planned',   docUrl: 'https://developers.trendyol.com/v2.0/docs/product-v2-api-endpoint', note: 'Faz 4 — content/variant/delivery bulk-update' },
    'stock.update':    { status: 'supported', docUrl: 'https://developers.trendyol.com/v2.0/docs/product-v2-api-endpoint', note: 'price-and-inventory, asenkron batch' },
    'price.update':    { status: 'supported', docUrl: 'https://developers.trendyol.com/v2.0/docs/product-v2-api-endpoint', note: 'Barkod başına 30 istek/dk' },
    'orders.read':     { status: 'supported', docUrl: 'https://developers.trendyol.com/v2.0/docs/get-order-packages-getshipmentpackages', note: 'Order V2, en fazla 2 haftalık aralık' },
    'shipping.update': { status: 'planned',   docUrl: 'https://developers.trendyol.com/v2.0/docs/get-order-packages-getshipmentpackages', note: 'updatePackage, changeCargoProvider, sendInvoiceLink' },
    'returns.read':    { status: 'supported', docUrl: 'https://developers.trendyol.com/docs/i%CC%87ade-s%C3%BCreci-ak%C4%B1%C5%9F%C4%B1', note: 'getClaims' },
    'returns.update':  { status: 'supported', docUrl: 'https://developers.trendyol.com/docs/i%CC%87ade-s%C3%BCreci-ak%C4%B1%C5%9F%C4%B1', note: 'approveClaimLineItems; ret talebi çoğu sebepte dosya ister (panelden)' },
    'questions.read':  { status: 'supported', docUrl: 'https://developers.trendyol.com/reference/getquestionfilter' },
    'questions.answer':{ status: 'supported', docUrl: 'https://developers.trendyol.com/reference/answerquestion', note: '10-2000 karakter; Trendyol incelemesi sonrası yayınlanır' },
    'reviews.read':    { status: 'unsupported', note: 'Resmî satıcı API dokümanında yorum uç noktası yok (29.10.2026)' },
    'reviews.reply':   { status: 'unsupported', note: 'API yok; yalnızca satıcı panelinden' },
    'ads.reports':     { status: 'unsupported', note: 'Trendyol Reklam için açık satıcı API dokümanı yok (29.10.2026)' },
    'ads.create':      { status: 'unsupported' },
    'ads.budget':      { status: 'unsupported' },
    'ads.pause':       { status: 'unsupported' },
    'categories.read': { status: 'supported', docUrl: 'https://developers.trendyol.com/v2.0/docs/trendyol-category-list-getcategorytree-1', note: '50 istek/dk' },
    'webhooks':        { status: 'planned',   docUrl: 'https://developers.trendyol.com/docs/webhook-model', note: 'Sipariş paketi olayları; satıcı başına 15 webhook' },
  };

  private headers(ctx: AdapterContext) {
    const { supplierId, apiKey, apiSecret } = ctx.credentials;
    if (!supplierId || !apiKey || !apiSecret) throw new Error('Trendyol için supplierId, apiKey ve apiSecret gerekli');
    return {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
      'User-Agent': `${supplierId} - SelfIntegration`,
    };
  }

  private sellerId(ctx: AdapterContext) {
    return ctx.credentials.supplierId;
  }

  async testConnection(ctx: AdapterContext) {
    try {
      // En hafif doğrulama: 1 ürünlük sayfa iste. 401/403 → anahtar hatalı.
      const r = await httpRequest<{ totalElements?: number }>({
        method: 'GET',
        url: `${this.baseUrl}/product/sellers/${this.sellerId(ctx)}/products/approved?page=0&size=1`,
        headers: this.headers(ctx),
        retries: 0,
      });
      return { ok: true, message: `Bağlantı başarılı. Trendyol'da ${r.totalElements ?? '?'} ürün görünüyor.` };
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status === 401 || e.status === 403) return { ok: false, message: 'Trendyol anahtarları reddedildi (401/403). API Key / Secret / Satıcı ID kontrol edin.' };
        return { ok: false, message: `Trendyol HTTP ${e.status}: ${e.body.slice(0, 200)}` };
      }
      return { ok: false, message: `Trendyol'a ulaşılamadı: ${(e as Error).message}` };
    }
  }

  async fetchCategories(ctx: AdapterContext): Promise<ExternalCategory[]> {
    interface Node { id: number; name: string; subCategories?: Node[] }
    const r = await httpRequest<{ categories: Node[] }>({ method: 'GET', url: `${this.baseUrl}/product/product-categories`, headers: this.headers(ctx) });
    const out: ExternalCategory[] = [];
    const walk = (nodes: Node[], parent?: string) => {
      for (const n of nodes) {
        const isLeaf = !n.subCategories || n.subCategories.length === 0;
        out.push({ externalId: String(n.id), parentExternalId: parent, name: n.name, isLeaf });
        if (!isLeaf) walk(n.subCategories!, String(n.id));
      }
    };
    walk(r.categories ?? []);
    return out;
  }

  async fetchCategoryAttributes(ctx: AdapterContext, categoryExternalId: string): Promise<ChannelAttributeDef[]> {
    interface A { attribute: { id: number; name: string }; required: boolean; allowCustom: boolean; varianter: boolean; slicer?: boolean; attributeValues?: { id: number; name: string }[] }
    const r = await httpRequest<{ categoryAttributes: A[] }>({ method: 'GET', url: `${this.baseUrl}/product/categories/${categoryExternalId}/attributes`, headers: this.headers(ctx) });
    return (r.categoryAttributes ?? []).map((a) => ({
      id: String(a.attribute.id), name: a.attribute.name, required: !!a.required, allowCustom: !!a.allowCustom, varianter: !!a.varianter,
      values: a.attributeValues?.map((v) => ({ id: String(v.id), name: v.name })),
    }));
  }

  async fetchAttributeValues(ctx: AdapterContext, categoryExternalId: string, attributeId: string) {
    const r = await httpRequest<{ attributeValues?: { id: number; name: string }[]; content?: { id: number; name: string }[] }>({
      method: 'GET', url: `${this.baseUrl}/product/categories/${categoryExternalId}/attributes/${attributeId}/values`, headers: this.headers(ctx),
    });
    return (r.attributeValues ?? r.content ?? []).map((v) => ({ id: String(v.id), name: v.name }));
  }

  async findBrands(ctx: AdapterContext, name: string): Promise<ExternalBrand[]> {
    const r = await httpRequest<{ id: number; name: string }[] | { brands?: { id: number; name: string }[] }>({
      method: 'GET', url: `${this.baseUrl}/product/brands/by-name?name=${encodeURIComponent(name)}`, headers: this.headers(ctx),
    });
    const list = Array.isArray(r) ? r : r.brands ?? [];
    return list.map((b) => ({ externalId: String(b.id), name: b.name }));
  }

  /** Product Create v2 — asenkron; sonuç checkBatch ile sorgulanır. */
  async createProducts(ctx: AdapterContext, products: ExternalProduct[]): Promise<PushResult[]> {
    const items = products.map((p) => ({
      barcode: p.barcode ?? p.externalId,
      title: (p.title ?? '').slice(0, 100),
      productMainId: (p.groupId ?? p.barcode ?? p.externalId).slice(0, 40),
      brandId: Number(p.brandExternalId),
      categoryId: Number(p.categoryExternalId),
      quantity: p.stock ?? 0,
      stockCode: p.sku?.slice(0, 100),
      dimensionalWeight: p.weightGrams ? Math.max(1, Math.ceil(p.weightGrams / 1000)) : 1,
      description: (p.description ?? p.title ?? '').slice(0, 30000),
      listPrice: p.price ?? p.salePrice ?? 0,
      salePrice: p.salePrice ?? p.price ?? 0,
      vatRate: Math.round(p.vatRate ?? 20),
      ...(p.originCountryCode ? { origin: p.originCountryCode } : {}),
      images: (p.images ?? []).slice(0, 8).map((url) => ({ url })),
      attributes: (p.channelAttributes ?? []).map((a) => ({
        attributeId: Number(a.attributeId),
        ...(a.valueId ? { attributeValueId: Number(a.valueId) } : {}),
        ...(a.customValue ? { customAttributeValue: a.customValue } : {}),
      })),
    }));
    try {
      const r = await httpRequest<{ batchRequestId: string }>({ method: 'POST', url: `${this.baseUrl}/product/sellers/${this.sellerId(ctx)}/v2/products`, headers: this.headers(ctx), body: { items } });
      return items.map((i) => ({ ok: true, externalId: i.barcode, batchRequestId: r.batchRequestId }));
    } catch (e) {
      return items.map((i) => ({ ok: false, externalId: i.barcode, error: (e as Error).message }));
    }
  }

  async checkBatch(ctx: AdapterContext, batchRequestId: string): Promise<BatchStatus> {
    interface R { status?: string; itemCount?: number; failedItemCount?: number; items?: { requestItem?: { barcode?: string }; status?: string; failureReasons?: string[] }[] }
    const r = await httpRequest<R>({ method: 'GET', url: `${this.baseUrl}/product/sellers/${this.sellerId(ctx)}/products/batch-requests/${batchRequestId}`, headers: this.headers(ctx) });
    const done = (r.status ?? '').toUpperCase() !== 'IN_PROGRESS';
    return {
      done,
      items: (r.items ?? []).map((i) => ({ externalId: i.requestItem?.barcode ?? '', ok: (i.status ?? '').toUpperCase() === 'SUCCESS', errors: i.failureReasons ?? [] })),
      raw: r,
    };
  }

  async fetchProducts(ctx: AdapterContext, cursor?: string): Promise<PagedResult<ExternalProduct>> {
    const page = Number(cursor ?? 0);
    const size = 200;
    interface TyProduct {
      id?: string; productCode?: number; barcode: string; stockCode?: string; title: string; description?: string; brand?: string;
      pimCategoryId?: number; listPrice?: number; salePrice?: number; quantity?: number; images?: { url: string }[];
      attributes?: { attributeName?: string; attributeValue?: string }[]; approved?: boolean; onSale?: boolean; archived?: boolean;
    }
    const r = await httpRequest<{ content: TyProduct[]; totalElements: number; totalPages: number }>({
      method: 'GET',
      url: `${this.baseUrl}/product/sellers/${this.sellerId(ctx)}/products/approved?page=${page}&size=${size}`,
      headers: this.headers(ctx),
    });
    const items = (r.content ?? []).map<ExternalProduct>((p) => ({
      externalId: p.barcode, // Trendyol'da ürünün benzersiz anahtarı barkoddur
      sku: p.stockCode,
      barcode: p.barcode,
      title: p.title,
      description: p.description,
      brand: p.brand,
      categoryExternalId: p.pimCategoryId ? String(p.pimCategoryId) : undefined,
      price: p.listPrice,
      salePrice: p.salePrice,
      stock: p.quantity,
      images: p.images?.map((i) => i.url),
      attributes: Object.fromEntries((p.attributes ?? []).filter((a) => a.attributeName).map((a) => [a.attributeName!, a.attributeValue ?? ''])),
      status: p.archived ? 'archived' : p.approved ? (p.onSale ? 'active' : 'paused') : 'pending',
      raw: p,
    }));
    return { items, total: r.totalElements, nextCursor: page + 1 < (r.totalPages ?? 0) ? String(page + 1) : undefined };
  }

  async updateStockAndPrice(ctx: AdapterContext, items: { barcode?: string; stock?: number; price?: number; salePrice?: number }[]): Promise<PushResult[]> {
    const payload = {
      items: items.filter((i) => i.barcode).map((i) => ({
        barcode: i.barcode,
        ...(i.stock !== undefined ? { quantity: i.stock } : {}),
        ...(i.price !== undefined ? { listPrice: i.price } : {}),
        ...(i.salePrice !== undefined ? { salePrice: i.salePrice } : i.price !== undefined ? { salePrice: i.price } : {}),
      })),
    };
    try {
      const r = await httpRequest<{ batchRequestId: string }>({
        method: 'POST',
        url: `${this.baseUrl}/inventory/sellers/${this.sellerId(ctx)}/products/price-and-inventory`,
        headers: this.headers(ctx),
        body: payload,
      });
      // Trendyol toplu işlemi asenkron yürütür; sonuç batchRequestId ile sorgulanır (Faz 4'te kuyruk işi).
      return payload.items.map(() => ({ ok: true, batchRequestId: r.batchRequestId }));
    } catch (e) {
      return payload.items.map(() => ({ ok: false, error: (e as Error).message }));
    }
  }

  async fetchOrders(ctx: AdapterContext, since: Date, cursor?: string): Promise<PagedResult<ExternalOrder>> {
    const page = Number(cursor ?? 0);
    interface TyLine { id: number; barcode: string; merchantSku?: string; productName: string; quantity: number; price: number; amount?: number; commission?: number }
    interface TyPackage {
      id: number; orderNumber: string; status: string; orderDate: number; customerFirstName?: string; customerLastName?: string; customerEmail?: string;
      shipmentAddress?: Record<string, unknown>; currencyCode?: string; totalPrice?: number; grossAmount?: number;
      cargoProviderName?: string; cargoTrackingNumber?: number | string; cargoTrackingLink?: string; shipmentPackageStatus?: string; lines: TyLine[];
    }
    const startDate = Math.max(since.getTime(), Date.now() - 14 * 86_400_000); // Trendyol en fazla 2 haftalık aralık kabul eder
    const r = await httpRequest<{ content: TyPackage[]; totalPages: number; totalElements: number }>({
      method: 'GET',
      url: `${this.baseUrl}/order/sellers/${this.sellerId(ctx)}/v2/orders?startDate=${startDate}&endDate=${Date.now()}&page=${page}&size=200&orderByField=PackageLastModifiedDate&orderByDirection=DESC`,
      headers: this.headers(ctx),
    });
    const items = (r.content ?? []).map<ExternalOrder>((p) => ({
      externalId: String(p.id),
      orderNumber: p.orderNumber,
      status: p.shipmentPackageStatus ?? p.status,
      orderedAt: new Date(p.orderDate),
      customer: { name: [p.customerFirstName, p.customerLastName].filter(Boolean).join(' '), email: p.customerEmail },
      shippingAddress: p.shipmentAddress,
      currency: p.currencyCode ?? 'TRY',
      grandTotal: p.totalPrice ?? p.grossAmount ?? 0,
      items: (p.lines ?? []).map((l) => ({
        externalId: String(l.id), barcode: l.barcode, sku: l.merchantSku, name: l.productName, quantity: l.quantity,
        unitPrice: l.price, lineTotal: l.amount ?? l.price * l.quantity, commission: l.commission,
      })),
      shipment: { carrierName: p.cargoProviderName, trackingNumber: p.cargoTrackingNumber ? String(p.cargoTrackingNumber) : undefined, trackingUrl: p.cargoTrackingLink, status: p.shipmentPackageStatus },
      raw: p,
    }));
    return { items, total: r.totalElements, nextCursor: page + 1 < (r.totalPages ?? 0) ? String(page + 1) : undefined };
  }

  async fetchReturns(ctx: AdapterContext, since: Date, cursor?: string): Promise<PagedResult<ExternalReturn>> {
    const page = Number(cursor ?? 0);
    interface Claim {
      id: string; orderNumber: string; orderDate?: number; claimDate: number; customerFirstName?: string; customerLastName?: string; cargoTrackingNumber?: string | number;
      items?: { orderLine?: { id?: number; productName?: string; barcode?: string; merchantSku?: string }; claimItems?: { id: string; orderLineItemId?: string; claimItemStatus?: { name?: string }; customerClaimItemReason?: { name?: string }; note?: string }[] }[];
    }
    const startDate = Math.max(since.getTime(), Date.now() - 14 * 86_400_000);
    const r = await httpRequest<{ content: Claim[]; totalPages?: number; totalElements?: number }>({
      method: 'GET', url: `${this.baseUrl}/order/sellers/${this.sellerId(ctx)}/claims?startDate=${startDate}&endDate=${Date.now()}&page=${page}&size=50`, headers: this.headers(ctx),
    });
    const items = (r.content ?? []).map<ExternalReturn>((c) => {
      const lines = (c.items ?? []).flatMap((it) => (it.claimItems ?? []).map((ci) => ({
        claimItemId: ci.id, orderLineExternalId: it.orderLine?.id != null ? String(it.orderLine.id) : undefined, barcode: it.orderLine?.barcode, sku: it.orderLine?.merchantSku,
        name: it.orderLine?.productName, quantity: 1, status: ci.claimItemStatus?.name, reason: ci.customerClaimItemReason?.name, note: ci.note,
      })));
      const statuses = [...new Set(lines.map((l) => l.status).filter(Boolean))] as string[];
      return {
        externalId: String(c.id), orderNumber: c.orderNumber, status: statuses.includes('WaitingInAction') ? 'WaitingInAction' : statuses[0] ?? 'Created',
        reason: lines[0]?.reason, customerName: [c.customerFirstName, c.customerLastName].filter(Boolean).join(' '), trackingNumber: c.cargoTrackingNumber ? String(c.cargoTrackingNumber) : undefined,
        requestedAt: new Date(c.claimDate), items: lines, raw: c,
      };
    });
    return { items, total: r.totalElements, nextCursor: page + 1 < (r.totalPages ?? 0) ? String(page + 1) : undefined };
  }

  async approveReturn(ctx: AdapterContext, returnExternalId: string, claimItemIds: string[]): Promise<PushResult> {
    try {
      await httpRequest({ method: 'PUT', url: `${this.baseUrl}/order/sellers/${this.sellerId(ctx)}/claims/${returnExternalId}/items/approve`, headers: this.headers(ctx), body: { claimLineItemIdList: claimItemIds, params: {} } });
      return { ok: true };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }

  async rejectReturn(ctx: AdapterContext, returnExternalId: string, claimItemIds: string[], reasonId: string, description: string): Promise<PushResult> {
    // Trendyol çoğu ret sebebinde dosya (kanıt) ister; dosyasız kabul edilen sebepler: 1651, 451, 2101. Dosyalı ret şimdilik satıcı panelinden.
    try {
      const q = new URLSearchParams({ claimIssueReasonId: reasonId, claimItemIdList: claimItemIds.join(','), description: description.slice(0, 500) });
      await httpRequest({ method: 'POST', url: `${this.baseUrl}/order/sellers/${this.sellerId(ctx)}/claims/${returnExternalId}/issue?${q}`, headers: this.headers(ctx) });
      return { ok: true };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }

  async fetchReturnRejectReasons(ctx: AdapterContext) {
    const r = await httpRequest<{ id: number; name: string }[] | { content?: { id: number; name: string }[] }>({ method: 'GET', url: `${this.baseUrl}/order/sellers/${this.sellerId(ctx)}/claims/issue-reasons`, headers: this.headers(ctx) });
    const list = Array.isArray(r) ? r : r.content ?? [];
    return list.map((x) => ({ id: String(x.id), name: x.name }));
  }

  async fetchQuestions(ctx: AdapterContext, since: Date, cursor?: string): Promise<PagedResult<ExternalQuestion>> {
    const page = Number(cursor ?? 0);
    interface TyQ { id: number; text: string; status: string; creationDate: number; userName?: string; productMainId?: string; webUrl?: string; answer?: unknown }
    const r = await httpRequest<{ content: TyQ[]; totalPages: number; totalElements: number }>({
      method: 'GET',
      url: `${this.baseUrl}/qna/sellers/${this.sellerId(ctx)}/questions/filter?startDate=${since.getTime()}&endDate=${Date.now()}&page=${page}&size=100`,
      headers: this.headers(ctx),
    });
    const items = (r.content ?? []).map<ExternalQuestion>((q) => ({
      externalId: String(q.id), productExternalId: q.productMainId, customerName: q.userName, text: q.text,
      askedAt: new Date(q.creationDate), status: q.status, raw: q,
    }));
    return { items, total: r.totalElements, nextCursor: page + 1 < (r.totalPages ?? 0) ? String(page + 1) : undefined };
  }

  async answerQuestion(ctx: AdapterContext, questionExternalId: string, text: string): Promise<PushResult> {
    try {
      await httpRequest({
        method: 'POST',
        url: `${this.baseUrl}/qna/sellers/${this.sellerId(ctx)}/questions/${questionExternalId}/answers`,
        headers: this.headers(ctx),
        body: { text },
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  // Henüz kodlanmayanlar: sahte başarı yerine açık hata.
  async updateProducts(): Promise<PushResult[]> { throw new UnsupportedOperationError(this.displayName, 'products.update'); }
  async updateShipment(): Promise<PushResult> { throw new UnsupportedOperationError(this.displayName, 'shipping.update'); }
}
