import {
  AdapterContext, BatchStatus, CapabilityMatrix, ChannelAdapter, ChannelAttributeDef, ExternalCategory, ExternalOrder, ExternalProduct,
  ExternalReturn, PagedResult, PushResult, ShipmentLabel,
} from '../adapter.interface';
import { HttpError, httpRequest } from '../http-client';

/**
 * HEPSİBURADA ADAPTÖRÜ
 * Üç API ailesi: MPOP (katalog/ürün), Listing (ilan, stok-fiyat), OMS (sipariş, paket, iade).
 * Kimlik: Basic Auth (username:password) + `User-Agent: {username} - SelfIntegration`. credentials: merchantId, username, password.
 * Test ortamı: settings.sandbox=true → "-sit" alt alan adları.
 * Doğrulama notu: developers.hepsiburada.com bu geliştirme ortamından okunamadı; uç noktalar yaygın kullanılan açık kaynak
 * istemciden (mustafa-m-ugur/hepsiburada-api-php) alınmıştır. Gerçek hesapla ilk testte alan adları/alanlar düzeltilebilir.
 */
export class HepsiburadaAdapter implements ChannelAdapter {
  readonly code = 'hepsiburada';
  readonly displayName = 'Hepsiburada';

  readonly capabilities: CapabilityMatrix = {
    'products.read':   { status: 'supported', docUrl: 'https://developers.hepsiburada.com', note: 'Listing API: listings/merchantid/{id} (ikincil kaynaktan doğrulandı)' },
    'products.create': { status: 'supported', docUrl: 'https://developers.hepsiburada.com', note: 'MPOP product/api/products/import (multipart JSON; ikincil kaynaktan, gerçek hesapla teyit edilecek)' },
    'products.update': { status: 'planned',   docUrl: 'https://developers.hepsiburada.com' },
    'stock.update':    { status: 'supported', docUrl: 'https://developers.hepsiburada.com', note: 'inventory-uploads (XML), asenkron id ile sorgulanır' },
    'price.update':    { status: 'supported', docUrl: 'https://developers.hepsiburada.com', note: 'inventory-uploads' },
    'orders.read':     { status: 'supported', docUrl: 'https://developers.hepsiburada.com', note: 'OMS orders + packages' },
    'shipping.update': { status: 'supported', docUrl: 'https://developers.hepsiburada.com', note: 'OMS packages (paketleme), invoice, etiket PDF, deliver (ownCargo)' },
    'returns.read':    { status: 'supported', docUrl: 'https://developers.hepsiburada.com', note: 'claims/merchantid/{id}' },
    'returns.update':  { status: 'supported', docUrl: 'https://developers.hepsiburada.com', note: 'claims/number/{no}/accept | reject' },
    'questions.read':  { status: 'unverified', note: 'İstemcide soru-cevap servisi yok; portalda doğrulanacak' },
    'questions.answer':{ status: 'unverified' },
    'reviews.read':    { status: 'unsupported', note: 'Dokümanda yok' }, 'reviews.reply': { status: 'unsupported' },
    'ads.reports':     { status: 'unsupported', note: 'Hepsiburada reklam API yok' }, 'ads.create': { status: 'unsupported' }, 'ads.budget': { status: 'unsupported' }, 'ads.pause': { status: 'unsupported' },
    'categories.read': { status: 'supported', docUrl: 'https://developers.hepsiburada.com', note: 'MPOP get-all-categories + attributes' },
    'webhooks':        { status: 'unsupported', note: 'Dokümanda yok' },
  };

  private host(ctx: AdapterContext, family: 'listing' | 'oms' | 'mpop') {
    const sit = ctx.settings.sandbox ? '-sit' : '';
    const sub = family === 'listing' ? 'listing-external' : family === 'oms' ? 'oms-external' : 'mpop';
    return `https://${sub}${sit}.hepsiburada.com`;
  }
  private headers(ctx: AdapterContext, accept = 'application/json') {
    const { username, password, merchantId } = ctx.credentials;
    if (!username || !password || !merchantId) throw new Error('Hepsiburada için merchantId, username ve password gerekli');
    return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`, 'User-Agent': `${username} - SelfIntegration`, Accept: accept };
  }
  private mid(ctx: AdapterContext) { return ctx.credentials.merchantId; }

  async testConnection(ctx: AdapterContext) {
    try {
      const r = await httpRequest<{ totalCount?: number; listings?: unknown[] }>({ method: 'GET', url: `${this.host(ctx, 'listing')}/listings/merchantid/${this.mid(ctx)}?offset=0&limit=1`, headers: this.headers(ctx), retries: 0 });
      return { ok: true, message: `Bağlantı başarılı.${r.totalCount != null ? ` Hepsiburada'da ${r.totalCount} ilan görünüyor.` : ''}` };
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) return { ok: false, message: 'Hepsiburada kimlik bilgileri reddedildi (401/403). Merchant ID, kullanıcı adı ve şifreyi (entegrasyon kullanıcısı) kontrol edin.' };
      return { ok: false, message: `Hepsiburada'ya ulaşılamadı: ${(e as Error).message}` };
    }
  }

  async fetchCategories(ctx: AdapterContext): Promise<ExternalCategory[]> {
    interface C { categoryId: number; name: string; parentCategoryId?: number | null; leaf?: boolean; status?: string }
    const out: ExternalCategory[] = []; let page = 0;
    for (;;) {
      const r = await httpRequest<{ data?: C[]; totalPages?: number }>({ method: 'GET', url: `${this.host(ctx, 'mpop')}/product/api/categories/get-all-categories?page=${page}&size=1000&version=1`, headers: this.headers(ctx) });
      for (const c of r.data ?? []) out.push({ externalId: String(c.categoryId), parentExternalId: c.parentCategoryId ? String(c.parentCategoryId) : undefined, name: c.name, isLeaf: !!c.leaf });
      page++; if (!r.totalPages || page >= r.totalPages || !(r.data ?? []).length) break;
    }
    return out;
  }

  async fetchCategoryAttributes(ctx: AdapterContext, categoryExternalId: string): Promise<ChannelAttributeDef[]> {
    interface A { id: string; name: string; mandatory?: boolean; type?: string; multiValue?: boolean }
    const r = await httpRequest<{ data?: { baseAttributes?: A[]; attributes?: A[]; variantAttributes?: A[] } }>({ method: 'GET', url: `${this.host(ctx, 'mpop')}/product/api/categories/${categoryExternalId}/attributes?version=1`, headers: this.headers(ctx) });
    const d = r.data ?? {};
    const map = (list: A[] | undefined, varianter: boolean) => (list ?? []).map<ChannelAttributeDef>((a) => ({ id: a.id, name: a.name, required: !!a.mandatory, allowCustom: (a.type ?? '').toLowerCase() !== 'enum', varianter }));
    return [...map(d.baseAttributes, false), ...map(d.attributes, false), ...map(d.variantAttributes, true)];
  }

  async fetchAttributeValues(ctx: AdapterContext, categoryExternalId: string, attributeId: string) {
    const r = await httpRequest<{ data?: { value: string; id?: string }[] }>({ method: 'GET', url: `${this.host(ctx, 'mpop')}/product/api/categories/${categoryExternalId}/attribute/${encodeURIComponent(attributeId)}/values?version=1&page=0&size=1000`, headers: this.headers(ctx) });
    return (r.data ?? []).map((v) => ({ id: v.id ?? v.value, name: v.value }));
  }

  async fetchProducts(ctx: AdapterContext, cursor?: string): Promise<PagedResult<ExternalProduct>> {
    const offset = Number(cursor ?? 0); const limit = 100;
    interface L { hepsiburadaSku: string; merchantSku: string; price?: number; availableStock?: number; isSalable?: boolean; productName?: string; barcode?: string; isDisabled?: boolean }
    const r = await httpRequest<{ listings?: L[]; totalCount?: number }>({ method: 'GET', url: `${this.host(ctx, 'listing')}/listings/merchantid/${this.mid(ctx)}?offset=${offset}&limit=${limit}`, headers: this.headers(ctx) });
    const items = (r.listings ?? []).map<ExternalProduct>((l) => ({ externalId: l.hepsiburadaSku, sku: l.merchantSku, barcode: l.barcode, title: l.productName ?? l.hepsiburadaSku, price: l.price, salePrice: l.price, stock: l.availableStock, status: l.isDisabled ? 'paused' : l.isSalable === false ? 'pending' : 'active', raw: l }));
    const next = offset + limit; return { items, total: r.totalCount, nextCursor: r.totalCount != null && next < r.totalCount ? String(next) : items.length === limit ? String(next) : undefined };
  }

  /** Listing inventory-uploads: XML gövde; sonuç id ile sorgulanır. */
  async updateStockAndPrice(ctx: AdapterContext, items: { externalId?: string; sku?: string; stock?: number; price?: number; salePrice?: number }[]): Promise<PushResult[]> {
    const rows = items.filter((i) => i.externalId && i.sku);
    if (!rows.length) return items.map(() => ({ ok: false, error: 'Hepsiburada SKU (hepsiburadaSku) ve merchantSku gerekli; önce ürünleri içe aktarın' }));
    const esc = (s: string | number) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const xml = `<?xml version="1.0" encoding="utf-8"?><listings xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">${rows.map((i) => `<listing><HepsiburadaSku>${esc(i.externalId!)}</HepsiburadaSku><MerchantSku>${esc(i.sku!)}</MerchantSku>${(i.salePrice ?? i.price) !== undefined ? `<Price>${esc((i.salePrice ?? i.price)!.toFixed(2))}</Price>` : ''}${i.stock !== undefined ? `<AvailableStock>${esc(i.stock)}</AvailableStock>` : ''}</listing>`).join('')}</listings>`;
    try {
      const res = await fetch(`${this.host(ctx, 'listing')}/listings/merchantid/${this.mid(ctx)}/inventory-uploads`, { method: 'POST', headers: { ...this.headers(ctx), 'Content-Type': 'application/xml' }, body: xml });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, text, 'inventory-uploads');
      const id = (() => { try { return (JSON.parse(text) as { id?: string; Id?: string }).id ?? (JSON.parse(text) as { Id?: string }).Id; } catch { return text.match(/<[iI]d>([^<]+)</)?.[1]; } })();
      return items.map((i) => ({ ok: !!(i.externalId && i.sku), externalId: i.externalId, batchRequestId: id, error: i.externalId && i.sku ? undefined : 'SKU eksik' }));
    } catch (e) { return items.map((i) => ({ ok: false, externalId: i.externalId, error: (e as Error).message })); }
  }

  /** MPOP katalog içe aktarma: JSON dizisi multipart dosya ('file') olarak gönderilir; yanıttaki trackingId 'mpop:' önekiyle batchRequestId olur. */
  async createProducts(ctx: AdapterContext, products: ExternalProduct[]): Promise<PushResult[]> {
    const rows = products.map((p) => {
      const attrs: Record<string, unknown> = { merchantSku: p.sku, Barcode: p.barcode, UrunAdi: p.title, UrunAciklamasi: p.description, Marka: p.brand, GarantiSuresi: ctx.settings.warrantyMonths ?? 24, kg: p.weightGrams !== undefined ? p.weightGrams / 1000 : undefined, tax_vat_rate: p.vatRate, price: p.salePrice ?? p.price, stock: p.stock };
      (p.images ?? []).slice(0, 5).forEach((u, i) => { attrs[`Image${i + 1}`] = u; });
      for (const a of p.channelAttributes ?? []) attrs[a.attributeId] = a.valueId ?? a.customValue;
      for (const k of Object.keys(attrs)) if (attrs[k] === undefined) delete attrs[k];
      return { categoryId: Number(p.categoryExternalId) || p.categoryExternalId, merchant: this.mid(ctx), attributes: attrs };
    });
    try {
      const form = new FormData();
      form.append('file', new Blob([JSON.stringify(rows)], { type: 'application/json' }), 'products.json');
      const res = await fetch(`${this.host(ctx, 'mpop')}/product/api/products/import`, { method: 'POST', headers: this.headers(ctx), body: form });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, text, 'products/import');
      const j = (() => { try { return JSON.parse(text) as { trackingId?: string; data?: { trackingId?: string } }; } catch { return {}; } })();
      const id = j.trackingId ?? j.data?.trackingId;
      if (!id) return products.map((p) => ({ ok: false, externalId: p.barcode ?? p.sku, error: `MPOP yanıtında trackingId yok: ${text.slice(0, 200)}` }));
      return products.map((p) => ({ ok: true, externalId: p.barcode ?? p.sku, batchRequestId: `mpop:${id}` }));
    } catch (e) { return products.map((p) => ({ ok: false, externalId: p.barcode ?? p.sku, error: (e as Error).message })); }
  }

  async checkBatch(ctx: AdapterContext, id: string): Promise<BatchStatus> {
    if (id.startsWith('mpop:')) return this.checkMpopBatch(ctx, id.slice(5));
    interface R { status?: string; errors?: { hepsiburadaSku?: string; merchantSku?: string; message?: string }[]; items?: { hepsiburadaSku?: string; status?: string; message?: string }[] }
    const r = await httpRequest<R>({ method: 'GET', url: `${this.host(ctx, 'listing')}/listings/merchantid/${this.mid(ctx)}/inventory-uploads/id/${id}`, headers: this.headers(ctx) });
    const done = !/progress|pending|queue/i.test(r.status ?? '');
    const errs = new Map((r.errors ?? []).map((e) => [e.hepsiburadaSku ?? e.merchantSku ?? '', e.message ?? 'hata']));
    return { done, items: [...(r.items ?? []).map((i) => ({ externalId: i.hepsiburadaSku ?? '', ok: !/fail|error/i.test(i.status ?? '') && !errs.has(i.hepsiburadaSku ?? ''), errors: [errs.get(i.hepsiburadaSku ?? '') ?? i.message].filter(Boolean) as string[] })), ...[...errs.entries()].filter(([k]) => !(r.items ?? []).some((i) => i.hepsiburadaSku === k)).map(([k, m]) => ({ externalId: k, ok: false, errors: [m] }))], raw: r };
  }

  /** MPOP içe aktarma durumu: status Done/Completed/Failed → bitti; her ürün barkod (yoksa merchantSku) ile raporlanır. */
  private async checkMpopBatch(ctx: AdapterContext, trackingId: string): Promise<BatchStatus> {
    interface Item { barcode?: string; merchantSku?: string; status?: string; errors?: (string | { message?: string })[]; validationResults?: (string | { message?: string })[]; message?: string; attributes?: { Barcode?: string; merchantSku?: string } }
    interface R { status?: string; data?: { status?: string; items?: Item[]; products?: Item[] }; items?: Item[]; products?: Item[] }
    const r = await httpRequest<R>({ method: 'GET', url: `${this.host(ctx, 'mpop')}/product/api/products/status/${encodeURIComponent(trackingId)}?version=1`, headers: this.headers(ctx) });
    const status = r.data?.status ?? r.status ?? '';
    const done = /^(done|completed|failed)$/i.test(status);
    const list = r.data?.items ?? r.data?.products ?? r.items ?? r.products ?? [];
    const items = list.map((i) => {
      const errors = [...(i.errors ?? []), ...(i.validationResults ?? [])].map((e) => (typeof e === 'string' ? e : e.message ?? '')).filter(Boolean);
      if (!errors.length && /fail|error|reject/i.test(i.status ?? '')) errors.push(i.message ?? i.status ?? 'hata');
      return { externalId: i.barcode ?? i.attributes?.Barcode ?? i.merchantSku ?? i.attributes?.merchantSku ?? '', ok: !errors.length, errors };
    });
    return { done, items, raw: r };
  }

  /** OMS: picking → paketle; invoiced → fatura no; shipped → ownCargo ise deliver, değilse etiket yeterli. */
  async updateShipment(ctx: AdapterContext, packageNumber: string, data: { status?: 'picking' | 'invoiced' | 'shipped'; lines?: { externalId: string; quantity: number }[]; invoiceNumber?: string; trackingNumber?: string; carrierCode?: string }): Promise<PushResult> {
    const base = `${this.host(ctx, 'oms')}/packages/merchantid/${this.mid(ctx)}`; const no = encodeURIComponent(packageNumber);
    try {
      if (data.status === 'picking') {
        if (!data.lines?.length) return { ok: false, error: 'Paketleme için sipariş kalemleri (lines) gerekli' };
        const r = await httpRequest<{ packageNumber?: string }>({ method: 'POST', url: base, headers: this.headers(ctx), body: { lineItemRequests: data.lines.map((l) => ({ id: l.externalId, quantity: l.quantity })) } });
        return { ok: true, externalId: r?.packageNumber ?? packageNumber };
      }
      if (data.status === 'invoiced') {
        if (!data.invoiceNumber) return { ok: false, error: 'Fatura bildirimi için invoiceNumber gerekli' };
        await httpRequest({ method: 'PUT', url: `${base}/packagenumber/${no}/invoice`, headers: this.headers(ctx), body: { invoiceNumber: data.invoiceNumber } });
        return { ok: true, externalId: packageNumber };
      }
      if (data.status === 'shipped') {
        if (!ctx.settings.ownCargo) return { ok: true, externalId: packageNumber }; // Hepsiburada anlaşmalı kargoda etiket yeterli
        if (!data.trackingNumber) return { ok: false, error: 'Kendi kargonuzla teslimat bildirimi için trackingNumber gerekli' };
        await httpRequest({ method: 'POST', url: `${base}/packagenumber/${no}/deliver`, headers: this.headers(ctx), body: { trackingNumber: data.trackingNumber, cargoCompany: data.carrierCode } });
        return { ok: true, externalId: packageNumber };
      }
      return { ok: false, error: `Bilinmeyen paket durumu: ${String(data.status)}` };
    } catch (e) { return { ok: false, externalId: packageNumber, error: (e as Error).message }; }
  }

  /** OMS etiket PDF'i; ikili yanıt için doğrudan fetch. */
  async fetchShipmentLabel(ctx: AdapterContext, packageNumber: string): Promise<ShipmentLabel> {
    const res = await fetch(`${this.host(ctx, 'oms')}/packages/merchantid/${this.mid(ctx)}/packagenumber/${encodeURIComponent(packageNumber)}/labels?format=pdf`, { method: 'GET', headers: this.headers(ctx, 'application/pdf') });
    if (!res.ok) throw new HttpError(res.status, await res.text(), 'labels');
    const base64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    if (!base64) throw new Error(`Hepsiburada ${packageNumber} paketi için etiket boş döndü`);
    return { contentType: 'application/pdf', base64, fileName: `hb-${packageNumber}.pdf` };
  }

  mapOrderStatus(s: string) {
    const m: Record<string, string> = { Open: 'NEW', Unpacked: 'NEW', Packaged: 'PACKED', ReadyToShip: 'PACKED', InTransit: 'SHIPPED', Shipped: 'SHIPPED', Delivered: 'DELIVERED', Cancelled: 'CANCELLED', CancelledByMerchant: 'CANCELLED', CancelledByCustomer: 'CANCELLED', Returned: 'RETURNED', UnDelivered: 'SHIPPED' };
    return m[s] ?? 'UNKNOWN';
  }

  /** OMS: önce paketler (kargo bilgisi burada), paketlenmemiş kalemler ayrıca. */
  async fetchOrders(ctx: AdapterContext, since: Date, cursor?: string): Promise<PagedResult<ExternalOrder>> {
    const offset = Number(cursor ?? 0); const limit = 50;
    const fmt = (d: Date) => d.toISOString().slice(0, 19);
    interface Item { id?: string; lineItemId?: string; orderLineItemId?: string; sku?: string; merchantSku?: string; productBarcode?: string; productName?: string; name?: string; quantity?: number; price?: { amount?: number } | number; totalPrice?: { amount?: number } | number; commission?: { amount?: number } | number; status?: string }
    interface Pkg { packageNumber?: string; orderNumber: string; status?: string; orderDate?: string; createdDate?: string; customerName?: string; recipientName?: string; shippingAddress?: Record<string, unknown>; deliveryAddress?: Record<string, unknown>; totalPrice?: { amount?: number } | number; cargoCompany?: string; cargoCompanyModel?: { name?: string }; barcode?: string; cargoTrackingNumber?: string; trackingUrl?: string; items?: Item[]; lineItems?: Item[] }
    const r = await httpRequest<{ items?: Pkg[]; packages?: Pkg[]; totalCount?: number }>({ method: 'GET', url: `${this.host(ctx, 'oms')}/packages/merchantid/${this.mid(ctx)}?offset=${offset}&limit=${limit}&beginDate=${encodeURIComponent(fmt(since))}&endDate=${encodeURIComponent(fmt(new Date()))}`, headers: this.headers(ctx) });
    const list = r.items ?? r.packages ?? [];
    const amt = (v: { amount?: number } | number | undefined) => (typeof v === 'number' ? v : v?.amount ?? 0);
    const items = list.map<ExternalOrder>((p) => {
      const lines = p.items ?? p.lineItems ?? [];
      return {
        externalId: p.packageNumber ?? p.orderNumber, orderNumber: p.orderNumber, status: p.status ?? 'Open', orderedAt: new Date(p.orderDate ?? p.createdDate ?? Date.now()),
        customer: { name: p.customerName ?? p.recipientName }, shippingAddress: p.shippingAddress ?? p.deliveryAddress, currency: 'TRY', grandTotal: amt(p.totalPrice),
        items: lines.map((l) => ({ externalId: l.lineItemId ?? l.orderLineItemId ?? l.id, sku: l.merchantSku ?? l.sku, barcode: l.productBarcode, name: l.productName ?? l.name ?? l.sku ?? '', quantity: l.quantity ?? 1, unitPrice: amt(l.price), lineTotal: amt(l.totalPrice) || amt(l.price) * (l.quantity ?? 1), commission: l.commission !== undefined ? amt(l.commission) : undefined })),
        shipment: { carrierName: p.cargoCompany ?? p.cargoCompanyModel?.name, trackingNumber: p.cargoTrackingNumber ?? p.barcode, trackingUrl: p.trackingUrl, status: p.status },
        raw: p,
      };
    });
    const next = offset + limit;
    return { items, total: r.totalCount, nextCursor: r.totalCount != null ? (next < r.totalCount ? String(next) : undefined) : list.length === limit ? String(next) : undefined };
  }

  async fetchReturns(ctx: AdapterContext, since: Date, cursor?: string): Promise<PagedResult<ExternalReturn>> {
    const offset = Number(cursor ?? 0); const limit = 50;
    interface Cl { claimNumber?: string; number?: string; orderNumber?: string; packageNumber?: string; status?: string; reason?: string; customerName?: string; createdDate?: string; claimDate?: string; items?: { lineItemId?: string; sku?: string; merchantSku?: string; quantity?: number; reason?: string }[]; cargoTrackingNumber?: string }
    const r = await httpRequest<{ items?: Cl[]; claims?: Cl[]; totalCount?: number }>({ method: 'GET', url: `${this.host(ctx, 'oms')}/claims/merchantid/${this.mid(ctx)}?offset=${offset}&limit=${limit}&beginDate=${encodeURIComponent(since.toISOString().slice(0, 19))}`, headers: this.headers(ctx) });
    const list = r.items ?? r.claims ?? [];
    const items = list.map<ExternalReturn>((c) => ({ externalId: c.claimNumber ?? c.number ?? '', orderExternalId: c.packageNumber, orderNumber: c.orderNumber, status: c.status ?? 'Created', reason: c.reason, customerName: c.customerName, trackingNumber: c.cargoTrackingNumber, requestedAt: new Date(c.createdDate ?? c.claimDate ?? Date.now()), items: (c.items ?? []).map((i) => ({ claimItemId: i.lineItemId ?? '', orderLineExternalId: i.lineItemId, sku: i.merchantSku ?? i.sku, quantity: i.quantity ?? 1, reason: i.reason })), raw: c }));
    const next = offset + limit; return { items, nextCursor: list.length === limit ? String(next) : undefined };
  }
  async approveReturn(ctx: AdapterContext, claimNumber: string): Promise<PushResult> {
    try { await httpRequest({ method: 'POST', url: `${this.host(ctx, 'oms')}/claims/number/${encodeURIComponent(claimNumber)}/accept`, headers: this.headers(ctx), body: {} }); return { ok: true }; } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
  async rejectReturn(ctx: AdapterContext, claimNumber: string, _items: string[], reasonId: string, description: string): Promise<PushResult> {
    try { await httpRequest({ method: 'POST', url: `${this.host(ctx, 'oms')}/claims/number/${encodeURIComponent(claimNumber)}/reject`, headers: this.headers(ctx), body: { rejectionReason: reasonId, description } }); return { ok: true }; } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
}
