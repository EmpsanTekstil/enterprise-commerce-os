import {
  AdapterContext, CapabilityMatrix, ChannelAdapter, ExternalOrder, ExternalProduct, PagedResult, PushResult,
} from '../adapter.interface';
import { HttpError, httpRequest } from '../http-client';

/**
 * SHOPIFY ADAPTÖRÜ — Admin GraphQL API (https://shopify.dev/docs/api/admin-graphql)
 * Kimlik: Custom App → "Admin API access token"; başlık X-Shopify-Access-Token.
 * credentials: shopDomain (ornek.myshopify.com), accessToken. settings.apiVersion (varsayılan 2026-01), settings.locationId (stok konumu).
 * Shopify bir pazaryeri değil, kendi mağazanız: soru/yorum/reklam kavramı yoktur (unsupported).
 */
export class ShopifyAdapter implements ChannelAdapter {
  readonly code = 'shopify';
  readonly displayName = 'Shopify';

  readonly capabilities: CapabilityMatrix = {
    'products.read':   { status: 'supported', docUrl: 'https://shopify.dev/docs/api/admin-graphql/latest/queries/products' },
    'products.create': { status: 'planned',   docUrl: 'https://shopify.dev/docs/api/admin-graphql/latest/mutations/productSet', note: 'productSet' },
    'products.update': { status: 'planned',   docUrl: 'https://shopify.dev/docs/api/admin-graphql/latest/mutations/productSet' },
    'stock.update':    { status: 'supported', docUrl: 'https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventorySetQuantities', note: 'settings.locationId gerekir; yoksa ilk aktif konum' },
    'price.update':    { status: 'supported', docUrl: 'https://shopify.dev/docs/api/admin-graphql/latest/mutations/productVariantsBulkUpdate' },
    'orders.read':     { status: 'supported', docUrl: 'https://shopify.dev/docs/api/admin-graphql/latest/queries/orders', note: 'read_orders; 60 günden eski için read_all_orders' },
    'shipping.update': { status: 'planned',   docUrl: 'https://shopify.dev/docs/api/admin-graphql/latest/mutations/fulfillmentCreate' },
    'returns.read':    { status: 'planned',   docUrl: 'https://shopify.dev/docs/api/admin-graphql/latest/objects/Return' },
    'returns.update':  { status: 'planned' },
    'questions.read':  { status: 'unsupported', note: 'Kendi mağaza: müşteri sorusu kavramı yok' }, 'questions.answer': { status: 'unsupported' },
    'reviews.read':    { status: 'unsupported', note: 'Yorumlar uygulama (ör. Judge.me) tarafındadır' }, 'reviews.reply': { status: 'unsupported' },
    'ads.reports':     { status: 'unsupported' }, 'ads.create': { status: 'unsupported' }, 'ads.budget': { status: 'unsupported' }, 'ads.pause': { status: 'unsupported' },
    'categories.read': { status: 'unsupported', note: 'Shopify kategori zorunluluğu yok (productType/tags)' },
    'webhooks':        { status: 'planned',   docUrl: 'https://shopify.dev/docs/api/admin-graphql/latest/mutations/webhookSubscriptionCreate' },
  };

  private endpoint(ctx: AdapterContext) {
    const { shopDomain, accessToken } = ctx.credentials;
    if (!shopDomain || !accessToken) throw new Error('Shopify için shopDomain ve accessToken gerekli');
    const host = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return { url: `https://${host}/admin/api/${String(ctx.settings.apiVersion ?? '2026-01')}/graphql.json`, headers: { 'X-Shopify-Access-Token': accessToken } };
  }

  private async gql<T>(ctx: AdapterContext, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const { url, headers } = this.endpoint(ctx);
    const r = await httpRequest<{ data?: T; errors?: { message: string }[] }>({ method: 'POST', url, headers, body: { query, variables } });
    if (r.errors?.length) throw new Error(`Shopify GraphQL: ${r.errors.map((e) => e.message).join('; ')}`);
    return r.data as T;
  }

  async testConnection(ctx: AdapterContext) {
    try {
      const d = await this.gql<{ shop: { name: string; myshopifyDomain: string } }>(ctx, `{ shop { name myshopifyDomain } }`);
      return { ok: true, message: `Bağlantı başarılı: ${d.shop.name} (${d.shop.myshopifyDomain})` };
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) return { ok: false, message: 'Shopify erişim anahtarı reddedildi. Custom app izinlerini (read_products, write_inventory, read_orders) ve token\'ı kontrol edin.' };
      return { ok: false, message: `Shopify'a ulaşılamadı: ${(e as Error).message}` };
    }
  }

  async fetchProducts(ctx: AdapterContext, cursor?: string): Promise<PagedResult<ExternalProduct>> {
    interface V { id: string; sku: string | null; barcode: string | null; title: string; price: string; compareAtPrice: string | null; inventoryQuantity: number; selectedOptions: { name: string; value: string }[]; inventoryItem: { id: string } }
    interface P { id: string; title: string; descriptionHtml: string; vendor: string; status: string; productType: string; images: { nodes: { url: string }[] }; variants: { nodes: V[] } }
    const d = await this.gql<{ products: { nodes: P[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(ctx, `
      query($after: String) { products(first: 50, after: $after) { pageInfo { hasNextPage endCursor } nodes {
        id title descriptionHtml vendor status productType images(first: 8) { nodes { url } }
        variants(first: 100) { nodes { id sku barcode title price compareAtPrice inventoryQuantity selectedOptions { name value } inventoryItem { id } } } } } }`, { after: cursor ?? null });
    const items: ExternalProduct[] = [];
    for (const p of d.products.nodes) {
      for (const v of p.variants.nodes) {
        const attrs = Object.fromEntries(v.selectedOptions.filter((o) => o.name !== 'Title').map((o) => [o.name, o.value]));
        items.push({
          externalId: v.id, sku: v.sku ?? undefined, barcode: v.barcode ?? undefined, title: p.variants.nodes.length > 1 ? `${p.title} - ${v.title}` : p.title, description: p.descriptionHtml, brand: p.vendor || undefined,
          groupId: p.id, price: v.compareAtPrice ? Number(v.compareAtPrice) : Number(v.price), salePrice: Number(v.price), stock: v.inventoryQuantity, images: p.images.nodes.map((i) => i.url),
          attributes: { ...attrs, ...(p.productType ? { Tür: p.productType } : {}) }, status: p.status === 'ACTIVE' ? 'active' : p.status === 'DRAFT' ? 'pending' : 'archived', raw: { product: p.id, variant: v, inventoryItemId: v.inventoryItem.id },
        });
      }
    }
    return { items, nextCursor: d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor ?? undefined : undefined };
  }

  private async locationId(ctx: AdapterContext) {
    if (ctx.settings.locationId) return String(ctx.settings.locationId);
    const d = await this.gql<{ locations: { nodes: { id: string; isActive: boolean }[] } }>(ctx, `{ locations(first: 5) { nodes { id isActive } } }`);
    const loc = d.locations.nodes.find((l) => l.isActive) ?? d.locations.nodes[0];
    if (!loc) throw new Error('Shopify mağazasında stok konumu bulunamadı');
    return loc.id;
  }

  async updateStockAndPrice(ctx: AdapterContext, items: { externalId?: string; stock?: number; price?: number; salePrice?: number }[]): Promise<PushResult[]> {
    const results: PushResult[] = [];
    const withId = items.filter((i) => i.externalId?.startsWith('gid://shopify/ProductVariant/'));
    if (!withId.length) return items.map(() => ({ ok: false, error: 'Shopify varyant kimliği (gid) yok; önce ürünleri içe aktarın' }));
    // Stok: inventoryItem id'leri gerekir
    const stockItems = withId.filter((i) => i.stock !== undefined);
    if (stockItems.length) {
      try {
        const q = await this.gql<{ nodes: ({ id: string; inventoryItem: { id: string } } | null)[] }>(ctx, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id inventoryItem { id } } } }`, { ids: stockItems.map((i) => i.externalId) });
        const inv = new Map(q.nodes.filter(Boolean).map((n) => [n!.id, n!.inventoryItem.id]));
        const locationId = await this.locationId(ctx);
        const r = await this.gql<{ inventorySetQuantities: { userErrors: { field: string[]; message: string }[] } }>(ctx, `mutation($input: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $input) { userErrors { field message } } }`,
          { input: { name: 'available', reason: 'correction', ignoreCompareQuantity: true, quantities: stockItems.filter((i) => inv.has(i.externalId!)).map((i) => ({ inventoryItemId: inv.get(i.externalId!), locationId, quantity: i.stock })) } });
        if (r.inventorySetQuantities.userErrors.length) throw new Error(r.inventorySetQuantities.userErrors.map((e) => e.message).join('; '));
      } catch (e) { return items.map(() => ({ ok: false, error: `Stok: ${(e as Error).message}` })); }
    }
    // Fiyat: ürün bazında productVariantsBulkUpdate
    const priceItems = withId.filter((i) => i.price !== undefined || i.salePrice !== undefined);
    if (priceItems.length) {
      try {
        const q = await this.gql<{ nodes: ({ id: string; product: { id: string } } | null)[] }>(ctx, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id product { id } } } }`, { ids: priceItems.map((i) => i.externalId) });
        const byProduct = new Map<string, typeof priceItems>();
        for (const n of q.nodes) { if (!n) continue; const it = priceItems.find((i) => i.externalId === n.id)!; byProduct.set(n.product.id, [...(byProduct.get(n.product.id) ?? []), it]); }
        for (const [productId, its] of byProduct) {
          const r = await this.gql<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(ctx, `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { message } } }`,
            { productId, variants: its.map((i) => { const sale = i.salePrice ?? i.price!; const list = i.price ?? sale; return { id: i.externalId, price: sale.toFixed(2), compareAtPrice: list > sale ? list.toFixed(2) : null }; }) });
          if (r.productVariantsBulkUpdate.userErrors.length) throw new Error(r.productVariantsBulkUpdate.userErrors.map((e) => e.message).join('; '));
        }
      } catch (e) { return items.map(() => ({ ok: false, error: `Fiyat: ${(e as Error).message}` })); }
    }
    for (const i of items) results.push({ ok: !!i.externalId?.startsWith('gid://'), externalId: i.externalId, error: i.externalId?.startsWith('gid://') ? undefined : 'Varyant kimliği yok' });
    return results;
  }

  mapOrderStatus(s: string) {
    const m: Record<string, string> = { UNFULFILLED: 'NEW', PARTIALLY_FULFILLED: 'PICKING', FULFILLED: 'SHIPPED', DELIVERED: 'DELIVERED', CANCELLED: 'CANCELLED', REFUNDED: 'RETURNED', ON_HOLD: 'NEW', SCHEDULED: 'NEW' };
    return m[s] ?? 'UNKNOWN';
  }

  async fetchOrders(ctx: AdapterContext, since: Date, cursor?: string): Promise<PagedResult<ExternalOrder>> {
    interface L { id: string; name: string; sku: string | null; quantity: number; variant: { id: string; barcode: string | null } | null; originalUnitPriceSet: { shopMoney: { amount: string } }; discountedTotalSet: { shopMoney: { amount: string } } }
    interface O { id: string; name: string; createdAt: string; cancelledAt: string | null; displayFulfillmentStatus: string; displayFinancialStatus: string; email: string | null; phone: string | null; customer: { displayName: string } | null; shippingAddress: Record<string, unknown> | null; currencyCode: string; totalPriceSet: { shopMoney: { amount: string } }; lineItems: { nodes: L[] }; fulfillments: { trackingInfo: { company: string | null; number: string | null; url: string | null }[]; status: string }[] }
    const d = await this.gql<{ orders: { nodes: O[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(ctx, `
      query($after: String, $q: String) { orders(first: 50, after: $after, query: $q, sortKey: UPDATED_AT, reverse: true) { pageInfo { hasNextPage endCursor } nodes {
        id name createdAt cancelledAt displayFulfillmentStatus displayFinancialStatus email phone customer { displayName } shippingAddress { name address1 address2 city province zip country phone } currencyCode
        totalPriceSet { shopMoney { amount } } lineItems(first: 100) { nodes { id name sku quantity variant { id barcode } originalUnitPriceSet { shopMoney { amount } } discountedTotalSet { shopMoney { amount } } } }
        fulfillments(first: 5) { status trackingInfo { company number url } } } } }`, { after: cursor ?? null, q: `updated_at:>=${since.toISOString()}` });
    const items = d.orders.nodes.map<ExternalOrder>((o) => {
      const status = o.cancelledAt ? 'CANCELLED' : o.displayFinancialStatus === 'REFUNDED' ? 'REFUNDED' : o.displayFulfillmentStatus;
      const f = o.fulfillments[0]; const t = f?.trackingInfo[0];
      return {
        externalId: o.id, orderNumber: o.name, status, orderedAt: new Date(o.createdAt), customer: { name: o.customer?.displayName, email: o.email ?? undefined, phone: o.phone ?? undefined }, shippingAddress: o.shippingAddress ?? undefined,
        currency: o.currencyCode, grandTotal: Number(o.totalPriceSet.shopMoney.amount),
        items: o.lineItems.nodes.map((l) => ({ externalId: l.id, sku: l.sku ?? undefined, barcode: l.variant?.barcode ?? undefined, name: l.name, quantity: l.quantity, unitPrice: Number(l.originalUnitPriceSet.shopMoney.amount), lineTotal: Number(l.discountedTotalSet.shopMoney.amount) })),
        shipment: t ? { carrierName: t.company ?? undefined, trackingNumber: t.number ?? undefined, trackingUrl: t.url ?? undefined, status: f.status } : undefined, raw: o,
      };
    });
    return { items, nextCursor: d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor ?? undefined : undefined };
  }
}
