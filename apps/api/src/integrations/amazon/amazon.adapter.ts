import { gunzipSync } from 'zlib';
import {
  AdapterContext, CapabilityMatrix, ChannelAdapter, ExternalAdMetric, ExternalCampaign, ExternalOrder, ExternalProduct, PagedResult, PushResult,
} from '../adapter.interface';
import { HttpError, httpRequest } from '../http-client';

/**
 * AMAZON TÜRKİYE — Selling Partner API (https://developer-docs.amazon.com/sp-api)
 * Bölge: EU uç noktası, pazar kimliği TR = A33AVAJ2PDY3EV.
 * Kimlik: Login with Amazon (LWA) — clientId, clientSecret, refreshToken → kısa ömürlü access token.
 * Erişim: Seller Central'da geliştirici profili + uygulama kaydı gerekir; alıcı adres/PII için "kısıtlı veri" rolü ayrı onay ister.
 * credentials: sellerId, clientId, clientSecret, refreshToken. settings.marketplaceId (varsayılan TR), settings.sandbox (true → sandbox uç noktası).
 * Reklam: Amazon Ads API (EU) ayrı başvuru ister — credentials.adsClientId, adsClientSecret, adsRefreshToken, adsProfileId.
 * settings.knownSkus (SKU listesi → Listings Items ile okuma), settings.defaultCarrierCode, settings.reportPollMs (rapor bekleme aralığı, varsayılan 5000).
 */
export class AmazonAdapter implements ChannelAdapter {
  readonly code = 'amazon_tr';
  readonly displayName = 'Amazon Türkiye';
  private tokenCache = new Map<string, { token: string; exp: number }>();
  private readonly adsBase = 'https://advertising-api-eu.amazon.com';

  readonly capabilities: CapabilityMatrix = {
    'products.read':   { status: 'conditional', docUrl: 'https://developer-docs.amazon.com/sp-api/docs/reports-api-v2021-06-30-reference', note: 'Reports API GET_MERCHANT_LISTINGS_ALL_DATA (asenkron rapor, cursor ile devam) veya settings.knownSkus ile Listings Items; geliştirici onayı gerekir' },
    'products.create': { status: 'planned',     docUrl: 'https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference', note: 'putListingsItem + Product Type Definitions' },
    'products.update': { status: 'planned',     docUrl: 'https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference' },
    'stock.update':    { status: 'conditional', docUrl: 'https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference', note: 'patchListingsItem fulfillment_availability (FBM)' },
    'price.update':    { status: 'conditional', docUrl: 'https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference', note: 'patchListingsItem purchasable_offer' },
    'orders.read':     { status: 'conditional', docUrl: 'https://developer-docs.amazon.com/sp-api/docs/orders-api-v0-reference', note: 'Alıcı adı/adres için kısıtlı veri (PII) rolü' },
    'shipping.update': { status: 'conditional', docUrl: 'https://developer-docs.amazon.com/sp-api/docs/orders-api-v0-reference', note: 'confirmShipment (FBM); picking/invoiced yalnızca yerel durum' },
    'returns.read':    { status: 'planned',     note: 'Raporlar (GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE)' },
    'returns.update':  { status: 'unsupported', note: 'API ile iade onayı yok; Seller Central' },
    'questions.read':  { status: 'unsupported', note: 'Alıcı Q&A API yok' }, 'questions.answer': { status: 'unsupported' },
    'reviews.read':    { status: 'unsupported', note: 'Yorum API yok' }, 'reviews.reply': { status: 'unsupported' },
    'ads.reports':     { status: 'conditional', docUrl: 'https://advertising.amazon.com/API/docs/en-us/reporting/v3/overview', note: 'Amazon Ads API Reporting v3 (spCampaigns, günlük) — Ads API ayrı başvuru/onay gerekir' },
    'ads.create':      { status: 'unsupported', note: 'Kampanya oluşturma bu sürümde yok' },
    'ads.budget':      { status: 'conditional', docUrl: 'https://advertising.amazon.com/API/docs/en-us/sponsored-products/3-0/openapi', note: 'Sponsored Products v3 PUT /sp/campaigns budget — Ads API ayrı başvuru' },
    'ads.pause':       { status: 'conditional', docUrl: 'https://advertising.amazon.com/API/docs/en-us/sponsored-products/3-0/openapi', note: 'Sponsored Products v3 PUT /sp/campaigns state — Ads API ayrı başvuru' },
    'categories.read': { status: 'planned',     docUrl: 'https://developer-docs.amazon.com/sp-api/docs/product-type-definitions-api-v2020-09-01-reference' },
    'webhooks':        { status: 'planned',     docUrl: 'https://developer-docs.amazon.com/sp-api/docs/notifications-api-v1-reference', note: 'SQS/EventBridge' },
  };

  private base(ctx: AdapterContext) { return ctx.settings.sandbox ? 'https://sandbox.sellingpartnerapi-eu.amazon.com' : 'https://sellingpartnerapi-eu.amazon.com'; }
  private marketplace(ctx: AdapterContext) { return String(ctx.settings.marketplaceId ?? 'A33AVAJ2PDY3EV'); }
  private pollMs(ctx: AdapterContext) { return Number(ctx.settings.reportPollMs ?? 5000); }
  private sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  /** LWA: refresh token → access token (anahtar bazlı önbellek; SP-API ve Ads ayrı anahtar). */
  private async lwaToken(key: string, clientId: string, clientSecret: string, refreshToken: string) {
    const c = this.tokenCache.get(key);
    if (c && c.exp > Date.now() + 60_000) return c.token;
    const res = await fetch('https://api.amazon.com/auth/o2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }) });
    const body = await res.json() as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!res.ok || !body.access_token) throw new Error(`LWA token alınamadı: ${body.error_description ?? body.error ?? res.status}`);
    this.tokenCache.set(key, { token: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 });
    return body.access_token;
  }

  private async accessToken(ctx: AdapterContext) {
    const { clientId, clientSecret, refreshToken } = ctx.credentials;
    if (!clientId || !clientSecret || !refreshToken || !ctx.credentials.sellerId) throw new Error('Amazon için sellerId, clientId, clientSecret ve refreshToken gerekli');
    return this.lwaToken(ctx.accountId, clientId, clientSecret, refreshToken);
  }

  private async headers(ctx: AdapterContext) { return { 'x-amz-access-token': await this.accessToken(ctx) }; }

  /** Ads API başlıkları: ayrı LWA uygulaması (adsClientId) + profil kapsamı. */
  private async adsHeaders(ctx: AdapterContext, contentType?: string) {
    const { adsClientId, adsClientSecret, adsRefreshToken, adsProfileId } = ctx.credentials;
    if (!adsClientId || !adsClientSecret || !adsRefreshToken || !adsProfileId) throw new Error('Amazon Ads için adsClientId, adsClientSecret, adsRefreshToken ve adsProfileId gerekli (Ads API, SP-API\'den ayrı başvuru/onay ister)');
    const token = await this.lwaToken(`${ctx.accountId}:ads`, adsClientId, adsClientSecret, adsRefreshToken);
    const h: Record<string, string> = { Authorization: `Bearer ${token}`, 'Amazon-Advertising-API-ClientId': adsClientId, 'Amazon-Advertising-API-Scope': adsProfileId };
    if (contentType) { h['Content-Type'] = contentType; h.Accept = contentType; }
    return h;
  }

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

  /** Ürünler: settings.knownSkus varsa Listings Items ile SKU bazlı; yoksa GET_MERCHANT_LISTINGS_ALL_DATA raporu (asenkron; hazır değilse cursor 'report:{id}' ile sonraki çağrıda devam). */
  async fetchProducts(ctx: AdapterContext, cursor?: string): Promise<PagedResult<ExternalProduct>> {
    const skus = (ctx.settings.knownSkus as string[] | undefined) ?? [];
    if (skus.length && !cursor?.startsWith('report:')) return this.fetchProductsBySku(ctx, skus, cursor);
    const base = this.base(ctx);
    let reportId = cursor?.startsWith('report:') ? cursor.slice(7) : undefined;
    if (!reportId) {
      const r = await httpRequest<{ reportId: string }>({ method: 'POST', url: `${base}/reports/2021-06-30/reports`, headers: await this.headers(ctx), body: { reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA', marketplaceIds: [this.marketplace(ctx)] } });
      reportId = r.reportId;
    }
    let documentId: string | undefined;
    for (let i = 0; i < 8; i++) {
      const r = await httpRequest<{ processingStatus: string; reportDocumentId?: string }>({ method: 'GET', url: `${base}/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`, headers: await this.headers(ctx) });
      if (r.processingStatus === 'DONE') { documentId = r.reportDocumentId; break; }
      if (r.processingStatus === 'CANCELLED' || r.processingStatus === 'FATAL') throw new Error(`Amazon ilan raporu ${reportId} ${r.processingStatus} durumunda (rapor üretilemedi)`);
      if (i < 7) await this.sleep(this.pollMs(ctx));
    }
    if (!documentId) return { items: [], nextCursor: `report:${reportId}` }; // hâlâ IN_QUEUE/IN_PROGRESS → sonraki senkronda devam
    const doc = await httpRequest<{ url: string; compressionAlgorithm?: string }>({ method: 'GET', url: `${base}/reports/2021-06-30/documents/${encodeURIComponent(documentId)}`, headers: await this.headers(ctx) });
    const text = await this.downloadText(doc.url, doc.compressionAlgorithm === 'GZIP');
    return { items: this.parseListingsTsv(text) };
  }

  /** Rapor belgesini ham metin olarak indirir (GZIP ise açar). */
  private async downloadText(url: string, gzip: boolean) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Amazon rapor belgesi indirilemedi: HTTP ${res.status}`);
    return gzip ? gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8') : res.text();
  }

  /** GET_MERCHANT_LISTINGS_ALL_DATA TSV → ExternalProduct (seller-sku, item-name, asin1, price, quantity, status, image-url). */
  parseListingsTsv(text: string): ExternalProduct[] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length < 2) return [];
    const head = lines[0].replace(/^﻿/, '').split('\t').map((h) => h.trim().toLowerCase());
    const col = (row: string[], name: string) => { const i = head.indexOf(name); return i >= 0 ? (row[i] ?? '').trim() : ''; };
    const num = (v: string) => { const n = Number(v.replace(',', '.')); return v && Number.isFinite(n) ? n : undefined; };
    const out: ExternalProduct[] = [];
    for (const line of lines.slice(1)) {
      const row = line.split('\t'); const sku = col(row, 'seller-sku');
      if (!sku) continue;
      const price = num(col(row, 'price')); const img = col(row, 'image-url'); const st = col(row, 'status');
      out.push({ externalId: sku, sku, title: col(row, 'item-name') || sku, price, salePrice: price, stock: num(col(row, 'quantity')), images: img ? [img] : [], status: /^active$/i.test(st) ? 'active' : 'paused', attributes: { ASIN: col(row, 'asin1') }, raw: Object.fromEntries(head.map((h, i) => [h, row[i] ?? ''])) });
    }
    return out;
  }

  private async fetchProductsBySku(ctx: AdapterContext, skus: string[], cursor?: string): Promise<PagedResult<ExternalProduct>> {
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

  /** Kargo bildirimi: 'shipped' + takip no → confirmShipment (204). 'picking'/'invoiced' Amazon'da karşılıksız → yerel durum, ok. */
  async updateShipment(ctx: AdapterContext, orderExternalId: string, data: { status?: 'picking' | 'invoiced' | 'shipped'; lines?: { externalId: string; quantity: number }[]; invoiceNumber?: string; trackingNumber?: string; carrierCode?: string }): Promise<PushResult> {
    if (data.status !== 'shipped') return { ok: true, externalId: orderExternalId };
    if (!data.trackingNumber) return { ok: false, externalId: orderExternalId, error: 'Amazon kargo bildirimi için takip numarası gerekli' };
    try {
      await httpRequest<void>({ method: 'POST', url: `${this.base(ctx)}/orders/v0/orders/${encodeURIComponent(orderExternalId)}/shipmentConfirmation`, headers: await this.headers(ctx), body: {
        marketplaceId: this.marketplace(ctx),
        packageDetail: { packageReferenceId: '1', carrierCode: data.carrierCode ?? String(ctx.settings.defaultCarrierCode ?? 'Other'), trackingNumber: data.trackingNumber, shipDate: new Date().toISOString(), orderItems: (data.lines ?? []).map((l) => ({ orderItemId: l.externalId, quantity: l.quantity })) },
      } });
      return { ok: true, externalId: orderExternalId };
    } catch (e) { return { ok: false, externalId: orderExternalId, error: (e as Error).message }; }
  }

  // --- Amazon Ads API (Sponsored Products v3 + Reporting v3) ---

  mapCampaignState(s: string) { const m: Record<string, string> = { ENABLED: 'ACTIVE', PAUSED: 'PAUSED', ARCHIVED: 'ARCHIVED' }; return m[s] ?? s; }

  async fetchCampaigns(ctx: AdapterContext): Promise<ExternalCampaign[]> {
    interface C { campaignId: string; name: string; state: string; budget?: { budget?: number; budgetType?: string }; startDate?: string; endDate?: string; targetingType?: string }
    const out: ExternalCampaign[] = []; let nextToken: string | undefined;
    do {
      const r = await httpRequest<{ campaigns?: C[]; nextToken?: string }>({ method: 'POST', url: `${this.adsBase}/sp/campaigns/list`, headers: await this.adsHeaders(ctx, 'application/vnd.spCampaign.v3+json'), body: { maxResults: 100, ...(nextToken ? { nextToken } : {}) } });
      for (const c of r.campaigns ?? []) out.push({ externalId: String(c.campaignId), name: c.name, type: c.targetingType ?? 'SPONSORED_PRODUCTS', status: this.mapCampaignState(c.state), dailyBudget: c.budget?.budget, startDate: c.startDate ? new Date(c.startDate) : undefined, endDate: c.endDate ? new Date(c.endDate) : undefined, raw: c });
      nextToken = r.nextToken;
    } while (nextToken);
    return out;
  }

  /** Reporting v3: spCampaigns günlük rapor (asenkron). Süre içinde tamamlanmazsa boş liste + uyarı. */
  async fetchAdMetrics(ctx: AdapterContext, from: Date, to: Date): Promise<ExternalAdMetric[]> {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const ct = 'application/vnd.createasyncreportrequest.v3+json';
    const created = await httpRequest<{ reportId: string }>({ method: 'POST', url: `${this.adsBase}/reporting/reports`, headers: await this.adsHeaders(ctx, ct), body: {
      name: `eco-spCampaigns-${day(from)}-${day(to)}`, startDate: day(from), endDate: day(to),
      configuration: { adProduct: 'SPONSORED_PRODUCTS', groupBy: ['campaign'], columns: ['campaignId', 'date', 'impressions', 'clicks', 'cost', 'purchases14d', 'sales14d'], reportTypeId: 'spCampaigns', timeUnit: 'DAILY', format: 'GZIP_JSON' },
    } });
    let url: string | undefined;
    for (let i = 0; i < 10; i++) {
      const r = await httpRequest<{ status: string; url?: string; failureReason?: string }>({ method: 'GET', url: `${this.adsBase}/reporting/reports/${encodeURIComponent(created.reportId)}`, headers: await this.adsHeaders(ctx, ct) });
      if (r.status === 'COMPLETED') { url = r.url; break; }
      if (r.status === 'FAILURE') throw new Error(`Amazon Ads raporu ${created.reportId} başarısız: ${r.failureReason ?? 'bilinmiyor'}`);
      if (i < 9) await this.sleep(this.pollMs(ctx));
    }
    if (!url) { console.warn(`Amazon Ads raporu ${created.reportId} süre içinde tamamlanmadı; boş metrik döndürülüyor`); return []; }
    interface Row { campaignId: number | string; date: string; impressions?: number; clicks?: number; cost?: number; purchases14d?: number; sales14d?: number }
    const rows = JSON.parse(await this.downloadText(url, true)) as Row[];
    return rows.map((r) => ({ campaignExternalId: String(r.campaignId), date: new Date(r.date), impressions: r.impressions ?? 0, clicks: r.clicks ?? 0, spend: r.cost ?? 0, orders: r.purchases14d ?? 0, sales: r.sales14d ?? 0 }));
  }

  async updateCampaign(ctx: AdapterContext, campaignExternalId: string, data: { status?: 'ACTIVE' | 'PAUSED'; dailyBudget?: number }): Promise<PushResult> {
    const c: Record<string, unknown> = { campaignId: campaignExternalId };
    if (data.status) c.state = data.status === 'ACTIVE' ? 'ENABLED' : 'PAUSED';
    if (data.dailyBudget !== undefined) c.budget = { budget: data.dailyBudget, budgetType: 'DAILY' };
    try {
      const r = await httpRequest<{ campaigns?: { success?: { campaignId: string }[]; error?: { errors?: { errorType?: string; errorValue?: unknown }[] }[] } }>({ method: 'PUT', url: `${this.adsBase}/sp/campaigns`, headers: await this.adsHeaders(ctx, 'application/vnd.spCampaign.v3+json'), body: { campaigns: [c] } });
      const err = r.campaigns?.error?.[0];
      return err ? { ok: false, externalId: campaignExternalId, error: JSON.stringify(err.errors ?? err) } : { ok: !!r.campaigns?.success?.length, externalId: campaignExternalId, error: r.campaigns?.success?.length ? undefined : 'Amazon Ads yanıtında başarı kaydı yok' };
    } catch (e) { return { ok: false, externalId: campaignExternalId, error: (e as Error).message }; }
  }
}
