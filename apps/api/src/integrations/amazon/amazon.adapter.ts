import {
  AdapterContext, CapabilityMatrix, ChannelAdapter, ExternalOrder, ExternalProduct, PagedResult, PushResult,
} from '../adapter.interface';
import { HttpError, httpRequest } from '../http-client';

/**
 * AMAZON TÜRKİYE — Selling Partner API (https://developer-docs.amazon.com/sp-api)
 * Bölge: EU uç noktası, pazar kimliği TR = A33AVAJ2PDY3EV.
 * Kimlik: Login with Amazon (LWA) — clientId, clientSecret, refreshToken → kısa ömürlü access token.
 * Erişim: Seller Central'da geliştirici profili + uygulama kaydı gerekir; alıcı adres/PII için "kısıtlı veri" rolü ayrı onay ister.
 * credentials: sellerId, clientId, clientSecret, refreshToken. settings.marketplaceId (varsayılan TR), settings.sandbox (true → sandbox uç noktası).
 */
export class AmazonAdapter implements ChannelAdapter {
  readonly code = 'amazon_tr';
  readonly displayName = 'Amazon Türkiye';
  private tokenCache = new Map<string, { token: string; exp: number }>();

  readonly capabilities: CapabilityMatrix = {
    'products.read':   { status: 'conditional', docUrl: 'https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference', note: 'Listings Items + Reports (GET_MERCHANT_LISTINGS_ALL_DATA); geliştirici onayı gerekir' },
    'products.create': { status: 'planned',     docUrl: 'https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference', note: 'putListingsItem + Product Type Definitions' },
    'products.update': { status: 'planned',     docUrl: 'https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference' },
    'stock.update':    { status: 'conditional', docUrl: 'https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference', note: 'patchListingsItem fulfillment_availability (FBM)' },
    'price.update':    { status: 'conditional', docUrl: 'https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference', note: 'patchListingsItem purchasable_offer' },
    'orders.read':     { status: 'conditional', docUrl: 'https://developer-docs.amazon.com/sp-api/docs/orders-api-v0-reference', note: 'Alıcı adı/adres için kısıtlı veri (PII) rolü' },
    'shipping.update': { status: 'planned',     docUrl: 'https://developer-docs.amazon.com/sp-api/docs/orders-api-v0-reference', note: 'confirmShipment' },
    'returns.read':    { status: 'planned',     note: 'Raporlar (GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE)' },
    'returns.update':  { status: 'unsupported', note: 'API ile iade onayı yok; Seller Central' },
    'questions.read':  { status: 'unsupported', note: 'Alıcı Q&A API yok' }, 'questions.answer': { status: 'unsupported' },
    'reviews.read':    { status: 'unsupported', note: 'Yorum API yok' }, 'reviews.reply': { status: 'unsupported' },
    'ads.reports':     { status: 'conditional', docUrl: 'https://advertising.amazon.com/API/docs', note: 'Amazon Ads API — ayrı başvuru/onay; Faz 7 devamında' },
    'ads.create':      { status: 'conditional' }, 'ads.budget': { status: 'conditional' }, 'ads.pause': { status: 'conditional' },
    'categories.read': { status: 'planned',     docUrl: 'https://developer-docs.amazon.com/sp-api/docs/product-type-definitions-api-v2020-09-01-reference' },
    'webhooks':        { status: 'planned',     docUrl: 'https://developer-docs.amazon.com/sp-api/docs/notifications-api-v1-reference', note: 'SQS/EventBridge' },
  };

  private base(ctx: AdapterContext) { return ctx.settings.sandbox ? 'https://sandbox.sellingpartnerapi-eu.amazon.com' : 'https://sellingpartnerapi-eu.amazon.com'; }
  private marketplace(ctx: AdapterContext) { return String(ctx.settings.marketplaceId ?? 'A33AVAJ2PDY3EV'); }

  /** LWA: refresh token → access token (önbellekli). */
  private async accessToken(ctx: AdapterContext) {
    const { clientId, clientSecret, refreshToken } = ctx.credentials;
    if (!clientId || !clientSecret || !refreshToken || !ctx.credentials.sellerId) throw new Error('Amazon için sellerId, clientId, clientSecret ve refreshToken gerekli');
    const c = this.tokenCache.get(ctx.accountId);
    if (c && c.exp > Date.now() + 60_000) return c.token;
    const res = await fetch('https://api.amazon.com/auth/o2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }) });
    const body = await res.json() as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!res.ok || !body.access_token) throw new Error(`LWA token alınamadı: ${body.error_description ?? body.error ?? res.status}`);
    this.tokenCache.set(ctx.accountId, { token: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 });
    return body.access_token;
  }

  private async headers(ctx: AdapterContext) { return { 'x-amz-access-token': await this.accessToken(ctx) }; }

  async testConnection(ctx: AdapterContext) {
    try {
      const r = await httpRequest<{ payload?: { marketplaceId: string; name: string }[] | { marketplace: { id: string; name: string } }[] }>({ method: 'GET', url: `${this.base(ctx)}/sellers/v1/marketplaceParticipations`, headers: await this.headers(ctx), retries: 0 });
      const list = (r.payload ?? []) as { marketplace?: { id: string; name: string } }[];
      const tr = list.find((m) => m.marketplace?.id === this.marketplace(ctx));
      return tr ? { ok: true, message: `Bağlantı başarılı: ${tr.marketplace!.name} pazarına katılım doğrulandı.` } : { ok: !!list.length, message: list.length ? `Bağlantı var ancak ${this.marketplace(ctx)} pazarına katılım görünmüyor (${list.length} pazar).` : 'Pazar katılımı dönmedi.' };
    } catch (e) {
      if (e instanceof HttpError && e.status === 403) return { ok: false, message: 'Amazon 403: uygulama rolleri/onayı eksik olabilir (Seller Central → Geliştirici Merkezi).' };
      return { ok: false, message: `Amazon'a ulaşılamadı: ${(e as Error).message}` };
    }
  }

  /** Aktif ilanlar: GET_MERCHANT_LISTINGS_ALL_DATA raporu yerine (asenkron), küçük kataloglar için Listings Items + searchCatalogItems kullanılmaz; ilk sürümde rapor akışı planlı. */
  async fetchProducts(ctx: AdapterContext, cursor?: string): Promise<PagedResult<ExternalProduct>> {
    // Rapor tabanlı toplu çekme Faz 5 devamında; şimdilik Listings Items ile SKU bazlı okuma mümkün değil (SKU listesi gerekir).
    const skus = (ctx.settings.knownSkus as string[] | undefined) ?? [];
    if (!skus.length) throw new Error('Amazon ürün çekme için rapor akışı henüz uygulanmadı; hesap ayarlarına knownSkus listesi verilirse Listings Items ile okunur.');
    const page = Number(cursor ?? 0); const batch = skus.slice(page * 20, page * 20 + 20);
    const items: ExternalProduct[] = [];
    for (const sku of batch) {
      interface LI { sku: string; summaries?: { itemName?: string; asin?: string; status?: string[]; mainImage?: { link: string } }[]; offers?: { price?: { amount: string } }[]; fulfillmentAvailability?: { quantity?: number }[]; attributes?: Record<string, { value?: string }[]> }
      const r = await httpRequest<LI>({ method: 'GET', url: `${this.base(ctx)}/listings/2021-08-01/items/${encodeURIComponent(ctx.credentials.sellerId)}/${encodeURIComponent(sku)}?marketplaceIds=${this.marketplace(ctx)}&includedData=summaries,offers,fulfillmentAvailability,attributes`, headers: await this.headers(ctx) });
      const s = r.summaries?.[0];
      items.push({ externalId: sku, sku, title: s?.itemName ?? sku, brand: r.attributes?.brand?.[0]?.value, price: r.offers?.[0]?.price ? Number(r.offers[0].price!.amount) : undefined, salePrice: r.offers?.[0]?.price ? Number(r.offers[0].price!.amount) : undefined, stock: r.fulfillmentAvailability?.[0]?.quantity, images: s?.mainImage ? [s.mainImage.link] : [], status: s?.status?.includes('BUYABLE') ? 'active' : 'paused', attributes: { ASIN: s?.asin ?? '' }, raw: r });
    }
    return { items, nextCursor: (page + 1) * 20 < skus.length ? String(page + 1) : undefined };
  }

  async updateStockAndPrice(ctx: AdapterContext, items: { sku?: string; stock?: number; price?: number; salePrice?: number }[]): Promise<PushResult[]> {
    const out: PushResult[] = [];
    for (const i of items) {
      if (!i.sku) { out.push({ ok: false, error: 'SKU yok' }); continue; }
      const patches: unknown[] = [];
      if (i.stock !== undefined) patches.push({ op: 'replace', path: '/attributes/fulfillment_availability', value: [{ fulfillment_channel_code: 'DEFAULT', quantity: i.stock }] });
      const price = i.salePrice ?? i.price;
      if (price !== undefined) patches.push({ op: 'replace', path: '/attributes/purchasable_offer', value: [{ marketplace_id: this.marketplace(ctx), currency: 'TRY', our_price: [{ schedule: [{ value_with_tax: price }] }] }] });
      try {
        const r = await httpRequest<{ status: string; submissionId?: string; issues?: { message: string }[] }>({ method: 'PATCH', url: `${this.base(ctx)}/listings/2021-08-01/items/${encodeURIComponent(ctx.credentials.sellerId)}/${encodeURIComponent(i.sku)}?marketplaceIds=${this.marketplace(ctx)}`, headers: await this.headers(ctx), body: { productType: String(ctx.settings.defaultProductType ?? 'PRODUCT'), patches } });
        out.push({ ok: r.status === 'ACCEPTED', externalId: i.sku, batchRequestId: r.submissionId, error: r.status === 'ACCEPTED' ? undefined : (r.issues ?? []).map((x) => x.message).join('; ') || r.status });
      } catch (e) { out.push({ ok: false, externalId: i.sku, error: (e as Error).message }); }
    }
    return out;
  }

  mapOrderStatus(s: string) {
    const m: Record<string, string> = { Pending: 'NEW', Unshipped: 'NEW', PartiallyShipped: 'PICKING', Shipped: 'SHIPPED', Canceled: 'CANCELLED', Unfulfillable: 'CANCELLED', InvoiceUnconfirmed: 'PACKED', PendingAvailability: 'NEW' };
    return m[s] ?? 'UNKNOWN';
  }

  async fetchOrders(ctx: AdapterContext, since: Date, cursor?: string): Promise<PagedResult<ExternalOrder>> {
    interface O { AmazonOrderId: string; OrderStatus: string; PurchaseDate: string; LastUpdateDate: string; OrderTotal?: { Amount: string; CurrencyCode: string }; BuyerInfo?: { BuyerName?: string; BuyerEmail?: string }; ShippingAddress?: Record<string, unknown>; FulfillmentChannel?: string }
    const q = new URLSearchParams({ MarketplaceIds: this.marketplace(ctx), LastUpdatedAfter: new Date(Math.min(since.getTime(), Date.now() - 120_000)).toISOString(), MaxResultsPerPage: '50' });
    if (cursor) q.set('NextToken', cursor);
    const r = await httpRequest<{ payload: { Orders: O[]; NextToken?: string } }>({ method: 'GET', url: `${this.base(ctx)}/orders/v0/orders?${q}`, headers: await this.headers(ctx) });
    const items: ExternalOrder[] = [];
    for (const o of r.payload.Orders ?? []) {
      interface It { OrderItemId: string; SellerSKU?: string; Title?: string; QuantityOrdered: number; ItemPrice?: { Amount: string } }
      let lines: It[] = [];
      try { lines = (await httpRequest<{ payload: { OrderItems: It[] } }>({ method: 'GET', url: `${this.base(ctx)}/orders/v0/orders/${o.AmazonOrderId}/orderItems`, headers: await this.headers(ctx) })).payload.OrderItems ?? []; } catch { /* kalemler alınamazsa sipariş yine kaydedilir */ }
      items.push({
        externalId: o.AmazonOrderId, orderNumber: o.AmazonOrderId, status: o.OrderStatus, orderedAt: new Date(o.PurchaseDate),
        customer: { name: o.BuyerInfo?.BuyerName, email: o.BuyerInfo?.BuyerEmail }, shippingAddress: o.ShippingAddress, currency: o.OrderTotal?.CurrencyCode ?? 'TRY', grandTotal: o.OrderTotal ? Number(o.OrderTotal.Amount) : 0,
        items: lines.map((l) => ({ externalId: l.OrderItemId, sku: l.SellerSKU, name: l.Title ?? l.SellerSKU ?? '', quantity: l.QuantityOrdered, unitPrice: l.ItemPrice ? Number(l.ItemPrice.Amount) / Math.max(1, l.QuantityOrdered) : 0, lineTotal: l.ItemPrice ? Number(l.ItemPrice.Amount) : 0 })),
        raw: o,
      });
    }
    return { items, nextCursor: r.payload.NextToken };
  }
}
