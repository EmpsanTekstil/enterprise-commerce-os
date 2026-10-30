import {
  AdapterContext, BatchStatus, CapabilityMatrix, ChannelAdapter, ExternalCategory, ExternalOrder, ExternalProduct, ExternalQuestion,
  PagedResult, PushResult,
} from '../adapter.interface';
import { HttpError, httpRequest } from '../http-client';

/**
 * n11 ADAPTÖRÜ — REST (https://developer.n11.com)
 * Kimlik: başlıklar `appKey` ve `appSecret`. credentials: appKey, appSecret, integrator (isteğe bağlı etiket).
 * Ürün yükleme/stok-fiyat asenkron "task" döner; sonuç Task Detail servisiyle sorgulanır.
 * Soru-cevap servisi n11'de hâlâ SOAP'tır (productService.wsdl); burada SOAP zarfı elle kurulur.
 */
export class N11Adapter implements ChannelAdapter {
  readonly code = 'n11';
  readonly displayName = 'n11';
  readonly baseUrl = process.env.N11_BASE_URL ?? 'https://api.n11.com';

  readonly capabilities: CapabilityMatrix = {
    'products.read':   { status: 'supported', docUrl: 'https://developer.n11.com/documentation/n11-marketplace-entegrasyonu/satici-urun-sorgulama/' },
    'products.create': { status: 'supported', docUrl: 'https://developer.n11.com/documentation/n11-marketplace-entegrasyonu/urun-yukleme/', note: 'shipmentTemplate ve preparingDay hesap ayarlarından alınır' },
    'products.update': { status: 'planned',   docUrl: 'https://developer.n11.com/documentation/n11-marketplace-entegrasyonu/urun-bilgisi-guncelleme/' },
    'stock.update':    { status: 'supported', docUrl: 'https://developer.n11.com/documentation/n11-marketplace-entegrasyonu/urun-fiyat-stok-guncelleme/', note: 'Asenkron task; 1000 SKU/istek' },
    'price.update':    { status: 'supported', docUrl: 'https://developer.n11.com/documentation/n11-marketplace-entegrasyonu/urun-fiyat-stok-guncelleme/', note: 'listPrice ≥ salePrice, birlikte gönderilir' },
    'orders.read':     { status: 'supported', docUrl: 'https://developer.n11.com/documentation/elements/siparis-listeleme-servisi/', note: 'sayfa 100, 1000 istek/dk' },
    'shipping.update': { status: 'supported', docUrl: 'https://developer.n11.com/documentation/n11-siparis-entegrasyonu/siparis-kalemlerini-guncelleme-servisi/', note: 'PUT /rest/order/v1/update; dokümanda yalnız Picking var. Shipped+takip no alanları doğrulanmadı, gerçek hesapla teyit' },
    'returns.read':    { status: 'planned',   docUrl: 'https://developer.n11.com/documentation/iade-entgrasyonu/iade-talepleri-servisi/' },
    'returns.update':  { status: 'planned' },
    'questions.read':  { status: 'supported', docUrl: 'https://developer.n11.com/documentation/n11-marketplace-entegrasyonu/urun-soru-cevap-servisi/', note: 'SOAP; dakikada 1 listeleme' },
    'questions.answer':{ status: 'supported', docUrl: 'https://developer.n11.com/documentation/n11-marketplace-entegrasyonu/urun-soru-cevap-servisi/', note: 'Her soru bir kez cevaplanır; 1-2048 karakter' },
    'reviews.read':    { status: 'unsupported', note: 'Resmî dokümanda yorum servisi yok' },
    'reviews.reply':   { status: 'unsupported' },
    'ads.reports':     { status: 'unsupported' }, 'ads.create': { status: 'unsupported' }, 'ads.budget': { status: 'unsupported' }, 'ads.pause': { status: 'unsupported' },
    'categories.read': { status: 'supported', docUrl: 'https://developer.n11.com/documentation/n11-marketplace-entegrasyonu/kategori-agaci-listeleme/' },
    'webhooks':        { status: 'unsupported', note: 'Dokümanda yok' },
  };

  private headers(ctx: AdapterContext) {
    const { appKey, appSecret } = ctx.credentials;
    if (!appKey || !appSecret) throw new Error('n11 için appKey ve appSecret gerekli');
    return { appKey, appSecret };
  }
  private integrator(ctx: AdapterContext) { return ctx.credentials.integrator || 'EnterpriseCommerceOS'; }

  async testConnection(ctx: AdapterContext) {
    try {
      const r = await httpRequest<{ totalElements?: number }>({ method: 'GET', url: `${this.baseUrl}/ms/product-query?page=0&size=1`, headers: this.headers(ctx), retries: 0 });
      return { ok: true, message: `Bağlantı başarılı. n11'de ${r.totalElements ?? '?'} ürün görünüyor.` };
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) return { ok: false, message: 'n11 anahtarları reddedildi (401/403). appKey / appSecret kontrol edin.' };
      return { ok: false, message: `n11'e ulaşılamadı: ${(e as Error).message}` };
    }
  }

  async fetchCategories(ctx: AdapterContext): Promise<ExternalCategory[]> {
    interface Node { id: number; parentId: number | null; name: string; subCategories: Node[] | null }
    const r = await httpRequest<{ categories: Node[] }>({ method: 'GET', url: `${this.baseUrl}/cdn/categories`, headers: this.headers(ctx) });
    const out: ExternalCategory[] = [];
    const walk = (nodes: Node[]) => { for (const n of nodes) { out.push({ externalId: String(n.id), parentExternalId: n.parentId == null ? undefined : String(n.parentId), name: n.name, isLeaf: !n.subCategories || n.subCategories.length === 0 }); if (n.subCategories) walk(n.subCategories); } };
    walk(r.categories ?? []);
    return out;
  }

  async fetchProducts(ctx: AdapterContext, cursor?: string): Promise<PagedResult<ExternalProduct>> {
    const page = Number(cursor ?? 0);
    interface P { n11ProductId: number; stockCode: string; title: string; description?: string; categoryId?: number; productMainId?: string; status?: string; saleStatus?: string; barcode?: string; salePrice?: number; listPrice?: number; quantity?: number; attributes?: { attributeId: number; attributeName: string; attributeValue: string }[]; imageUrls?: string[]; vatRate?: number }
    const r = await httpRequest<{ content: P[]; totalElements: number; totalPages: number }>({ method: 'GET', url: `${this.baseUrl}/ms/product-query?page=${page}&size=250`, headers: this.headers(ctx) });
    const items = (r.content ?? []).map<ExternalProduct>((p) => ({
      externalId: String(p.n11ProductId), sku: p.stockCode, barcode: p.barcode || undefined, title: p.title, description: p.description,
      brand: p.attributes?.find((a) => a.attributeName === 'Marka')?.attributeValue, categoryExternalId: p.categoryId ? String(p.categoryId) : undefined, groupId: p.productMainId,
      price: p.listPrice, salePrice: p.salePrice, stock: p.quantity, images: p.imageUrls, vatRate: p.vatRate,
      attributes: Object.fromEntries((p.attributes ?? []).map((a) => [a.attributeName, a.attributeValue])),
      status: p.status === 'Active' ? (p.saleStatus === 'On_Sale' ? 'active' : 'paused') : p.status === 'InApproval' || p.status === 'InCatalogApproval' ? 'pending' : p.status === 'Unlisted' ? 'archived' : 'paused',
      raw: p,
    }));
    return { items, total: r.totalElements, nextCursor: page + 1 < (r.totalPages ?? 0) ? String(page + 1) : undefined };
  }

  async updateStockAndPrice(ctx: AdapterContext, items: { sku?: string; stock?: number; price?: number; salePrice?: number }[]): Promise<PushResult[]> {
    const skus = items.filter((i) => i.sku).map((i) => {
      const o: Record<string, unknown> = { stockCode: i.sku };
      if (i.stock !== undefined) o.quantity = i.stock;
      const list = i.price ?? i.salePrice; const sale = i.salePrice ?? i.price;
      if (list !== undefined && sale !== undefined) { o.listPrice = Number(Math.max(list, sale).toFixed(2)); o.salePrice = Number(sale.toFixed(2)); o.currencyType = 'TL'; }
      return o;
    });
    try {
      const r = await httpRequest<{ id: number; status: string; reasons?: string[] }>({ method: 'POST', url: `${this.baseUrl}/ms/product/tasks/price-stock-update`, headers: this.headers(ctx), body: { payload: { integrator: this.integrator(ctx), skus } } });
      const ok = r.status !== 'REJECT';
      return skus.map(() => ({ ok, batchRequestId: String(r.id), error: ok ? undefined : (r.reasons ?? []).join('; ') }));
    } catch (e) { return skus.map(() => ({ ok: false, error: (e as Error).message })); }
  }

  async createProducts(ctx: AdapterContext, products: ExternalProduct[]): Promise<PushResult[]> {
    const shipmentTemplate = String(ctx.settings.shipmentTemplate ?? ''); const preparingDay = Number(ctx.settings.preparingDay ?? 1);
    if (!shipmentTemplate) return products.map(() => ({ ok: false, error: 'n11 için hesap ayarlarında "shipmentTemplate" (kargo şablonu adı) gerekli' }));
    const skus = products.map((p) => ({
      title: p.title, description: p.description ?? p.title, categoryId: Number(p.categoryExternalId), currencyType: 'TL', productMainId: p.groupId ?? p.sku ?? p.externalId,
      preparingDay, shipmentTemplate, stockCode: p.sku ?? p.externalId, barcode: p.barcode ?? null, quantity: p.stock ?? 0,
      images: (p.images ?? []).map((url, i) => ({ url, order: i })),
      attributes: (p.channelAttributes ?? []).map((a) => ({ id: Number(a.attributeId), valueId: a.valueId ? Number(a.valueId) : null, customValue: a.customValue ?? null })),
      salePrice: p.salePrice ?? p.price ?? 0, listPrice: Math.max(p.price ?? 0, p.salePrice ?? 0), vatRate: Math.round(p.vatRate ?? 20),
    }));
    try {
      const r = await httpRequest<{ id: number; status: string; reasons?: string[] }>({ method: 'POST', url: `${this.baseUrl}/ms/product/tasks/product-create`, headers: this.headers(ctx), body: { payload: { integrator: this.integrator(ctx), skus } } });
      const ok = r.status !== 'REJECT';
      return skus.map((s) => ({ ok, externalId: s.stockCode, batchRequestId: String(r.id), error: ok ? undefined : (r.reasons ?? []).join('; ') }));
    } catch (e) { return skus.map((s) => ({ ok: false, externalId: s.stockCode, error: (e as Error).message })); }
  }

  async checkBatch(ctx: AdapterContext, taskId: string): Promise<BatchStatus> {
    interface R { id: number; status: string; type?: string; reasons?: string[]; skus?: { stockCode?: string; status?: string; reasons?: string[] }[] }
    const r = await httpRequest<R>({ method: 'GET', url: `${this.baseUrl}/ms/product/tasks/${taskId}`, headers: this.headers(ctx) });
    const done = !['IN_QUEUE', 'IN_PROGRESS', 'PROCESSING'].includes((r.status ?? '').toUpperCase());
    return { done, items: (r.skus ?? []).map((s) => ({ externalId: s.stockCode ?? '', ok: (s.status ?? '').toUpperCase() === 'SUCCESS', errors: s.reasons ?? [] })), raw: r };
  }

  mapOrderStatus(s: string) {
    const m: Record<string, string> = { Created: 'NEW', Picking: 'PICKING', Shipped: 'SHIPPED', Delivered: 'DELIVERED', Cancelled: 'CANCELLED', Unpacked: 'NEW', UnSupplied: 'CANCELLED', Returned: 'RETURNED' };
    return m[s] ?? 'UNKNOWN';
  }

  async fetchOrders(ctx: AdapterContext, since: Date, cursor?: string): Promise<PagedResult<ExternalOrder>> {
    const page = Number(cursor ?? 0);
    interface L { orderLineId: number; productId?: number; stockCode?: string; barcode?: string | null; productName: string; quantity: number; price: number; sellerInvoiceAmount?: number; commissionRate?: number; sellerDiscountedPrice?: number }
    interface P { id: string | number; orderNumber: string; shipmentPackageStatus: string; customerfullName?: string; customerEmail?: string; shippingAddress?: Record<string, unknown>; billingAddress?: Record<string, unknown>; cargoProviderName?: string; cargoTrackingNumber?: string; cargoTrackingLink?: string; lines: L[]; totalAmount?: number; lastModifiedDate?: number; packageHistories?: { createdDate: number; status: string }[] }
    const r = await httpRequest<{ content: P[]; totalPages?: number; pageCount?: number }>({
      method: 'GET', url: `${this.baseUrl}/rest/delivery/v1/shipmentPackages?startDate=${since.getTime()}&endDate=${Date.now()}&page=${page}&size=100&orderByField=true`, headers: this.headers(ctx),
    });
    const items = (r.content ?? []).map<ExternalOrder>((p) => {
      const created = p.packageHistories?.find((h) => h.status === 'Created')?.createdDate ?? p.packageHistories?.[0]?.createdDate ?? p.lastModifiedDate ?? Date.now();
      return {
        externalId: String(p.id), orderNumber: p.orderNumber, status: p.shipmentPackageStatus, orderedAt: new Date(created),
        customer: { name: p.customerfullName, email: p.customerEmail }, shippingAddress: p.shippingAddress, currency: 'TRY', grandTotal: p.totalAmount ?? 0,
        items: (p.lines ?? []).map((l) => ({ externalId: String(l.orderLineId), sku: l.stockCode, barcode: l.barcode ?? undefined, name: l.productName, quantity: l.quantity, unitPrice: l.price, lineTotal: (l.sellerDiscountedPrice ?? l.price) * l.quantity, commission: l.commissionRate != null ? Number((((l.sellerDiscountedPrice ?? l.price) * l.quantity * l.commissionRate) / 100).toFixed(2)) : undefined })),
        shipment: { carrierName: p.cargoProviderName, trackingNumber: p.cargoTrackingNumber, trackingUrl: p.cargoTrackingLink || undefined, status: p.shipmentPackageStatus },
        raw: p,
      };
    });
    const totalPages = r.totalPages ?? r.pageCount ?? 0;
    return { items, nextCursor: page + 1 < totalPages ? String(page + 1) : undefined };
  }

  /**
   * Sipariş kalemi güncelleme: PUT /rest/order/v1/update {lines:[{lineId}], status}. lineId = orderLineId (fetchOrders'daki kalem externalId).
   * Resmî dokümanda yalnız "Picking" tanımlı. "shipped" için trackingNumber/shipmentCompany alanları dokümanda yok — doğrulanmadı, gerçek hesapla teyit.
   * "invoiced": n11'de karşılığı yok (fatura ayrı "Fatura Linki Gönderme" servisi) → ok:true, işlem yapılmaz.
   */
  async updateShipment(ctx: AdapterContext, orderExternalId: string, data: { status?: 'picking' | 'invoiced' | 'shipped'; lines?: { externalId: string; quantity: number }[]; invoiceNumber?: string; trackingNumber?: string; carrierCode?: string }): Promise<PushResult> {
    if (data.status === 'invoiced') return { ok: true, externalId: orderExternalId };
    if (data.status !== 'picking' && data.status !== 'shipped') return { ok: false, externalId: orderExternalId, error: `n11 için desteklenmeyen statü: ${data.status ?? '(boş)'}` };
    if (data.status === 'shipped' && !data.trackingNumber) return { ok: false, externalId: orderExternalId, error: 'n11 kargo bildirimi için trackingNumber gerekli' };
    const ids = (data.lines ?? []).map((l) => Number(l.externalId)).filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) return { ok: false, externalId: orderExternalId, error: 'n11 kalem güncelleme için lines (orderLineId) gerekli' };
    const shipmentCompany = data.carrierCode ?? (ctx.settings.shipmentCompany ? String(ctx.settings.shipmentCompany) : undefined);
    const lines = ids.map((lineId) => data.status === 'shipped' ? { lineId, trackingNumber: data.trackingNumber, ...(shipmentCompany ? { shipmentCompany } : {}) } : { lineId });
    try {
      const r = await httpRequest<{ content?: { lineId: number; status?: string; reasons?: string }[] }>({ method: 'PUT', url: `${this.baseUrl}/rest/order/v1/update`, headers: this.headers(ctx), body: { lines, status: data.status === 'shipped' ? 'Shipped' : 'Picking' } });
      const failed = (r.content ?? []).filter((c) => (c.status ?? '').toUpperCase() !== 'SUCCESS');
      return failed.length ? { ok: false, externalId: orderExternalId, error: failed.map((c) => `${c.lineId}: ${c.reasons ?? c.status}`).join('; ') } : { ok: true, externalId: orderExternalId };
    } catch (e) { return { ok: false, externalId: orderExternalId, error: (e as Error).message }; }
  }

  // ---------------- SOAP soru-cevap ----------------
  private soap(ctx: AdapterContext, body: string) {
    const { appKey, appSecret } = this.headers(ctx);
    return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sch="http://www.n11.com/ws/schemas"><soapenv:Header/><soapenv:Body>${body.replace('<sch:auth/>', `<sch:auth><sch:appKey>${esc(appKey)}</sch:appKey><sch:appSecret>${esc(appSecret)}</sch:appSecret></sch:auth>`)}</soapenv:Body></soapenv:Envelope>`;
  }
  private async soapCall(ctx: AdapterContext, xml: string) {
    const res = await fetch(`${this.baseUrl}/ws/productService`, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8' }, body: xml });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, text, `${this.baseUrl}/ws/productService`);
    if (/<status>failure<\/status>/i.test(text)) throw new Error(`n11 SOAP hatası: ${tag(text, 'errorMessage') ?? text.slice(0, 200)}`);
    return text;
  }

  async fetchQuestions(ctx: AdapterContext, since: Date, cursor?: string): Promise<PagedResult<ExternalQuestion>> {
    const page = Number(cursor ?? 0);
    const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const xml = this.soap(ctx, `<sch:GetProductQuestionListRequest><sch:auth/><sch:productQuestionSearch><sch:status>OPEN</sch:status><sch:startDate>${fmt(since)}</sch:startDate><sch:endDate>${fmt(new Date())}</sch:endDate></sch:productQuestionSearch><sch:pagingData><sch:currentPage>${page}</sch:currentPage><sch:pageSize>100</sch:pageSize></sch:pagingData></sch:GetProductQuestionListRequest>`);
    const text = await this.soapCall(ctx, xml);
    const items: ExternalQuestion[] = [];
    for (const block of text.split('<productQuestion>').slice(1)) {
      const q = block.split('</productQuestion>')[0];
      items.push({ externalId: tag(q, 'id') ?? '', productExternalId: tag(q, 'productId'), text: unesc(tag(q, 'question') ?? ''), askedAt: since, status: tag(q, 'answer') ? 'ANSWERED' : 'OPEN', raw: q });
    }
    const pageCount = Number(tag(text, 'pageCount') ?? 1);
    return { items, nextCursor: page + 1 < pageCount ? String(page + 1) : undefined };
  }

  async answerQuestion(ctx: AdapterContext, questionExternalId: string, answer: string): Promise<PushResult> {
    try {
      await this.soapCall(ctx, this.soap(ctx, `<sch:SaveProductAnswerRequest><sch:auth/><sch:productQuestionId>${esc(questionExternalId)}</sch:productQuestionId><sch:answer>${esc(answer.slice(0, 2048))}</sch:answer></sch:SaveProductAnswerRequest>`));
      return { ok: true };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
}

function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function unesc(s: string) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/<!\[CDATA\[|\]\]>/g, ''); }
function tag(xml: string, name: string): string | undefined { const m = xml.match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`)); return m ? m[1].trim() : undefined; }
