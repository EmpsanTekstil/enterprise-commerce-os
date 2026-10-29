import {
  AdapterContext, BatchStatus, CapabilityMatrix, ChannelAdapter, ExternalOrder, ExternalProduct, PagedResult, PushResult,
} from '../adapter.interface';
import { HttpError, httpRequest } from '../http-client';

/**
 * idefix ADAPTÖRÜ — https://developer.idefix.com
 * Kimlik: `X-API-KEY: base64(ApiKey:ApiSecret)`. credentials: apiKey, apiSecret, vendorId.
 * Üretim: https://merchantapi.idefix.com (PIM: /pim, OMS: /oms). Test ortamı ayrı host + IP yetkisi ister.
 */
export class IdefixAdapter implements ChannelAdapter {
  readonly code = 'idefix';
  readonly displayName = 'idefix';
  readonly baseUrl = process.env.IDEFIX_BASE_URL ?? 'https://merchantapi.idefix.com';

  readonly capabilities: CapabilityMatrix = {
    'products.read':   { status: 'supported', docUrl: 'https://developer.idefix.com/api/urun-entegrasyonu/urunlerim-listesi' },
    'products.create': { status: 'planned',   docUrl: 'https://developer.idefix.com/api/urun-entegrasyonu/urun-olusturma', note: 'Kargo profili/adres kimlikleri gerekir' },
    'products.update': { status: 'planned',   docUrl: 'https://developer.idefix.com/api/urun-entegrasyonu/urun-olusturma' },
    'stock.update':    { status: 'supported', docUrl: 'https://developer.idefix.com/api/urun-entegrasyonu/stok-ve-fiyat-gonderim', note: 'inventory-upload, batchRequestId' },
    'price.update':    { status: 'supported', docUrl: 'https://developer.idefix.com/api/urun-entegrasyonu/stok-ve-fiyat-gonderim' },
    'orders.read':     { status: 'supported', docUrl: 'https://developer.idefix.com/api/siparis-entegrasyonu/siparislerin-alinmasi' },
    'shipping.update': { status: 'planned',   docUrl: 'https://developer.idefix.com/api/siparis-entegrasyonu/siparis-statu-guncelleme' },
    'returns.read':    { status: 'planned',   docUrl: 'https://developer.idefix.com/api/siparis-entegrasyonu/iade-listesi' },
    'returns.update':  { status: 'planned',   docUrl: 'https://developer.idefix.com/api/siparis-entegrasyonu/iade-onaylama' },
    'questions.read':  { status: 'planned',   docUrl: 'https://developer.idefix.com/api/soru-cevap-entegrasyonu' },
    'questions.answer':{ status: 'planned',   docUrl: 'https://developer.idefix.com/api/soru-cevap-entegrasyonu' },
    'reviews.read':    { status: 'unsupported', note: 'Dokümanda yok' }, 'reviews.reply': { status: 'unsupported' },
    'ads.reports':     { status: 'unsupported' }, 'ads.create': { status: 'unsupported' }, 'ads.budget': { status: 'unsupported' }, 'ads.pause': { status: 'unsupported' },
    'categories.read': { status: 'planned',   docUrl: 'https://developer.idefix.com/api/urun-entegrasyonu/kategorilerin-alinmasi' },
    'webhooks':        { status: 'unsupported', note: 'Dokümanda yok' },
  };

  private headers(ctx: AdapterContext) {
    const { apiKey, apiSecret } = ctx.credentials;
    if (!apiKey || !apiSecret || !ctx.credentials.vendorId) throw new Error('idefix için apiKey, apiSecret ve vendorId gerekli');
    return { 'X-API-KEY': Buffer.from(`${apiKey}:${apiSecret}`).toString('base64') };
  }
  private vendor(ctx: AdapterContext) { return ctx.credentials.vendorId; }

  async testConnection(ctx: AdapterContext) {
    try {
      const r = await httpRequest<{ products?: unknown[]; totalCount?: number }>({ method: 'GET', url: `${this.baseUrl}/pim/pool/${this.vendor(ctx)}/list?page=1&limit=1`, headers: this.headers(ctx), retries: 0 });
      return { ok: true, message: `Bağlantı başarılı.${r.totalCount != null ? ` idefix'te ${r.totalCount} ürün görünüyor.` : ''}` };
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) return { ok: false, message: 'idefix anahtarları reddedildi (401 VENDOR_TOKEN_NOT_EXIST). API Key / Secret kontrol edin.' };
      return { ok: false, message: `idefix'e ulaşılamadı: ${(e as Error).message}` };
    }
  }

  async fetchProducts(ctx: AdapterContext, cursor?: string): Promise<PagedResult<ExternalProduct>> {
    const page = Number(cursor ?? 1);
    interface P { productMainId?: string; reference?: string; barcode: string; vendorStockCode?: string; title: string; description?: string; price?: number; comparePrice?: number; inventoryQuantity?: number; status?: string; categoryId?: number; brandId?: number; images?: { url: string }[]; attributes?: { attributeId: number; attributeValueId?: number; customAttributeValue?: string }[]; vatRate?: number; weight?: number; failureReasons?: string[] }
    const r = await httpRequest<{ products: P[]; totalCount?: number; pageCount?: number }>({ method: 'GET', url: `${this.baseUrl}/pim/pool/${this.vendor(ctx)}/list?page=${page}&limit=100`, headers: this.headers(ctx) });
    const items = (r.products ?? []).map<ExternalProduct>((p) => ({
      externalId: p.barcode, barcode: p.barcode, sku: p.vendorStockCode, title: p.title, description: p.description, groupId: p.productMainId,
      categoryExternalId: p.categoryId != null ? String(p.categoryId) : undefined, brandExternalId: p.brandId != null ? String(p.brandId) : undefined,
      price: p.comparePrice && p.comparePrice > 0 ? p.comparePrice : p.price, salePrice: p.price, stock: p.inventoryQuantity, vatRate: p.vatRate, weightGrams: p.weight ? Math.round(p.weight * 1000) : undefined,
      images: p.images?.map((i) => i.url), status: /approved|active|on_sale/i.test(p.status ?? '') ? 'active' : /reject|fail/i.test(p.status ?? '') ? 'paused' : 'pending', raw: p,
    }));
    const pageCount = r.pageCount ?? (items.length === 100 ? page + 1 : page);
    return { items, total: r.totalCount, nextCursor: page < pageCount ? String(page + 1) : undefined };
  }

  async updateStockAndPrice(ctx: AdapterContext, items: { barcode?: string; stock?: number; price?: number; salePrice?: number }[]): Promise<PushResult[]> {
    const payload = items.filter((i) => i.barcode).map((i) => ({
      barcode: i.barcode, ...(i.salePrice ?? i.price) !== undefined ? { price: i.salePrice ?? i.price } : {}, ...(i.price !== undefined && i.salePrice !== undefined && i.price > i.salePrice ? { comparePrice: i.price } : {}), ...(i.stock !== undefined ? { inventoryQuantity: i.stock } : {}),
    }));
    try {
      const r = await httpRequest<{ batchRequestId: string; status?: string; items?: { barcode: string; status: string }[] }>({ method: 'POST', url: `${this.baseUrl}/pim/catalog/${this.vendor(ctx)}/inventory-upload`, headers: this.headers(ctx), body: { items: payload } });
      return payload.map((p) => { const it = r.items?.find((x) => x.barcode === p.barcode); const ok = !it || /completed|success/i.test(it.status); return { ok, externalId: p.barcode, batchRequestId: r.batchRequestId, error: ok ? undefined : it?.status }; });
    } catch (e) { return payload.map((p) => ({ ok: false, externalId: p.barcode, error: (e as Error).message })); }
  }

  async checkBatch(ctx: AdapterContext, batchRequestId: string): Promise<BatchStatus> {
    interface R { status: string; items?: { barcode: string; status: string; failureReasons?: string[] }[] }
    const r = await httpRequest<R>({ method: 'GET', url: `${this.baseUrl}/pim/catalog/${this.vendor(ctx)}/inventory-result/${batchRequestId}`, headers: this.headers(ctx) });
    return { done: !/progress|queue|pending/i.test(r.status ?? ''), items: (r.items ?? []).map((i) => ({ externalId: i.barcode, ok: /completed|success/i.test(i.status), errors: i.failureReasons ?? (/completed|success/i.test(i.status) ? [] : [i.status]) })), raw: r };
  }

  mapOrderStatus(s: string) {
    const m: Record<string, string> = { created: 'NEW', shipment_ready: 'NEW', shipment_approved: 'CONFIRMED', shipment_picking: 'PICKING', shipment_invoiced: 'PACKED', shipment_in_cargo: 'SHIPPED', shipment_undeliver: 'SHIPPED', shipment_delivered: 'DELIVERED', shipment_cancelled: 'CANCELLED', shipment_unsupplied: 'CANCELLED', shipment_split: 'NEW' };
    return m[s] ?? 'UNKNOWN';
  }

  async fetchOrders(ctx: AdapterContext, since: Date, cursor?: string): Promise<PagedResult<ExternalOrder>> {
    const page = Number(cursor ?? 1);
    const fmt = (d: Date) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    interface L { id: number; productName: string; barcode?: string; merchantSku?: string; price: number; discountedTotalPrice?: number; commissionAmount?: number; itemStatus?: string; quantity?: number }
    interface S { id: number; orderNumber: string; status: string; orderDate: string; customerContactName?: string; customerContactMail?: string; shippingAddress?: Record<string, unknown>; invoiceAddress?: Record<string, unknown>; totalPrice?: number; discountedTotalPrice?: number; cargoCompany?: string; cargoTrackingNumber?: string; cargoTrackingUrl?: string; items: L[] }
    const r = await httpRequest<{ items: S[]; pageCount?: number; totalCount?: number }>({
      method: 'GET', url: `${this.baseUrl}/oms/${this.vendor(ctx)}/list?vendor=${this.vendor(ctx)}&lastUpdatedAt=${encodeURIComponent(fmt(since))}&page=${page}&limit=50&sortByField=updateAt&sortDirection=desc`, headers: this.headers(ctx),
    });
    const items = (r.items ?? []).map<ExternalOrder>((s) => ({
      externalId: String(s.id), orderNumber: s.orderNumber, status: s.status, orderedAt: new Date(s.orderDate),
      customer: { name: s.customerContactName, email: s.customerContactMail }, shippingAddress: s.shippingAddress, billingAddress: s.invoiceAddress, currency: 'TRY',
      grandTotal: s.discountedTotalPrice ?? s.totalPrice ?? 0,
      items: (s.items ?? []).map((l) => ({ externalId: String(l.id), barcode: l.barcode, sku: l.merchantSku, name: l.productName, quantity: l.quantity ?? 1, unitPrice: l.price, lineTotal: l.discountedTotalPrice ?? l.price, commission: l.commissionAmount })),
      shipment: { carrierName: s.cargoCompany, trackingNumber: s.cargoTrackingNumber, trackingUrl: s.cargoTrackingUrl, status: s.status },
      raw: s,
    }));
    return { items, total: r.totalCount, nextCursor: r.pageCount && page < r.pageCount ? String(page + 1) : undefined };
  }
}
