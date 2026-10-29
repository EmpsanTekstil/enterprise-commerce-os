import {
  AdapterContext, CapabilityMatrix, ChannelAdapter, ExternalCategory, ExternalOrder, ExternalProduct,
  ExternalQuestion, PagedResult, PushResult, UnsupportedOperationError,
} from '../adapter.interface';
import { HttpError, httpRequest } from '../http-client';

/**
 * TRENDYOL ADAPTÖRÜ
 * Resmî doküman: https://developers.trendyol.com
 * Kimlik: Basic Auth (apiKey:apiSecret) + "User-Agent: {supplierId} - SelfIntegration"
 * Gerekli credentials alanları: supplierId, apiKey, apiSecret
 *
 * Uç noktalar docs/04-KANAL-API-YETENEK-MATRISI.md içinde doküman bağlantılarıyla listelenir.
 * Burada "status: planned" olan işlemler henüz kodlanmadı; çağrılırsa hata fırlatır.
 */
export class TrendyolAdapter implements ChannelAdapter {
  readonly code = 'trendyol';
  readonly displayName = 'Trendyol';
  readonly baseUrl = process.env.TRENDYOL_BASE_URL ?? 'https://apigw.trendyol.com/integration';

  readonly capabilities: CapabilityMatrix = {
    'products.read':   { status: 'supported', docUrl: 'https://developers.trendyol.com' },
    'products.create': { status: 'planned',   docUrl: 'https://developers.trendyol.com', note: 'Faz 4' },
    'products.update': { status: 'planned',   docUrl: 'https://developers.trendyol.com', note: 'Faz 4' },
    'stock.update':    { status: 'supported', docUrl: 'https://developers.trendyol.com' },
    'price.update':    { status: 'supported', docUrl: 'https://developers.trendyol.com' },
    'orders.read':     { status: 'supported', docUrl: 'https://developers.trendyol.com' },
    'shipping.update': { status: 'planned',   docUrl: 'https://developers.trendyol.com', note: 'Takip numarası ve paket durumu' },
    'returns.read':    { status: 'planned',   docUrl: 'https://developers.trendyol.com', note: 'İade talepleri (claims)' },
    'returns.update':  { status: 'planned',   docUrl: 'https://developers.trendyol.com', note: 'İade onay/ret' },
    'questions.read':  { status: 'supported', docUrl: 'https://developers.trendyol.com' },
    'questions.answer':{ status: 'supported', docUrl: 'https://developers.trendyol.com' },
    'reviews.read':    { status: 'unverified', note: 'Resmî dokümanda satıcı yorum okuma uç noktası doğrulanmadı' },
    'reviews.reply':   { status: 'unverified' },
    'ads.reports':     { status: 'unverified', note: 'Trendyol Reklam için açık API dokümanı doğrulanmadı' },
    'ads.create':      { status: 'unverified' },
    'ads.budget':      { status: 'unverified' },
    'ads.pause':       { status: 'unverified' },
    'categories.read': { status: 'supported', docUrl: 'https://developers.trendyol.com' },
    'webhooks':        { status: 'unverified' },
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
        url: `${this.baseUrl}/product/sellers/${this.sellerId(ctx)}/products?page=0&size=1`,
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

  async fetchCategoryAttributes(ctx: AdapterContext, categoryExternalId: string) {
    return httpRequest({ method: 'GET', url: `${this.baseUrl}/product/product-categories/${categoryExternalId}/attributes`, headers: this.headers(ctx) });
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
      url: `${this.baseUrl}/product/sellers/${this.sellerId(ctx)}/products?page=${page}&size=${size}`,
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
      url: `${this.baseUrl}/order/sellers/${this.sellerId(ctx)}/orders?startDate=${startDate}&endDate=${Date.now()}&page=${page}&size=200&orderByField=PackageLastModifiedDate&orderByDirection=DESC`,
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
  async createProducts(): Promise<PushResult[]> { throw new UnsupportedOperationError(this.displayName, 'products.create'); }
  async updateProducts(): Promise<PushResult[]> { throw new UnsupportedOperationError(this.displayName, 'products.update'); }
  async updateShipment(): Promise<PushResult> { throw new UnsupportedOperationError(this.displayName, 'shipping.update'); }
}
