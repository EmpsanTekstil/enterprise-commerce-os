import {
  AdapterContext, CapabilityMatrix, ChannelAdapter, ExternalCategory, ExternalOrder, ExternalProduct, PagedResult, PushResult,
} from '../adapter.interface';

/**
 * TEST KANALI — yalnızca ENABLE_MOCK_CHANNEL=1 veya NODE_ENV=test iken kayıtlıdır.
 * Deterministik veri üretir; uçtan uca testlerde gerçek bir pazaryeri yerine kullanılır.
 * Üretimde asla yüklenmez; "canlı bağlantı" gibi görünmez (kanal adı "Test Kanalı").
 */
export class MockAdapter implements ChannelAdapter {
  readonly code = 'mock';
  readonly displayName = 'Test Kanalı';
  /** Testlerin doğrulaması için: gönderilen stok/fiyat çağrıları */
  static pushed: { accountId: string; items: unknown[] }[] = [];
  /** Doluysa fetchOrders yalnızca bunları döndürür (testlerde durum değişimi simülasyonu) */
  static extraOrders: ExternalOrder[] = [];

  readonly capabilities: CapabilityMatrix = {
    'products.read': { status: 'supported' }, 'products.create': { status: 'supported' }, 'products.update': { status: 'supported' },
    'stock.update': { status: 'supported' }, 'price.update': { status: 'supported' }, 'orders.read': { status: 'supported' },
    'shipping.update': { status: 'unsupported' }, 'returns.read': { status: 'unsupported' }, 'returns.update': { status: 'unsupported' },
    'questions.read': { status: 'unsupported' }, 'questions.answer': { status: 'unsupported' }, 'reviews.read': { status: 'unsupported' },
    'reviews.reply': { status: 'unsupported' }, 'ads.reports': { status: 'unsupported' }, 'ads.create': { status: 'unsupported' },
    'ads.budget': { status: 'unsupported' }, 'ads.pause': { status: 'unsupported' }, 'categories.read': { status: 'supported' }, webhooks: { status: 'unsupported' },
  };

  async testConnection(ctx: AdapterContext) {
    return ctx.credentials.apiKey === 'test' ? { ok: true, message: 'Test kanalı bağlı' } : { ok: false, message: 'apiKey "test" olmalı' };
  }

  async fetchCategories(): Promise<ExternalCategory[]> {
    return [
      { externalId: '1', name: 'Giyim', isLeaf: false },
      { externalId: '11', parentExternalId: '1', name: 'Tişört', isLeaf: true },
      { externalId: '12', parentExternalId: '1', name: 'Pantolon', isLeaf: true },
    ];
  }

  async fetchProducts(): Promise<PagedResult<ExternalProduct>> {
    const items: ExternalProduct[] = [
      { externalId: '8690000000011', barcode: '8690000000011', sku: 'DEMO-TS-S', title: 'Pamuklu Tişört S', brand: 'DemoMarka', categoryExternalId: '11', price: 299, salePrice: 279, stock: 10, raw: {} },
      { externalId: '8699999999999', barcode: '8699999999999', sku: 'MOCK-ONLY-1', title: 'Yalnızca Kanalda Olan Ürün', brand: 'X', categoryExternalId: '12', price: 500, stock: 3, raw: {} },
      { externalId: '8698888888888', barcode: '8698888888888', sku: 'DEMO-TS-M', title: 'Pamuklu Tişört M (SKU ile eşleşir)', brand: 'DemoMarka', categoryExternalId: '11', price: 299, stock: 5, raw: {} },
    ];
    return { items, total: items.length };
  }

  async updateStockAndPrice(ctx: AdapterContext, items: unknown[]): Promise<PushResult[]> {
    MockAdapter.pushed.push({ accountId: ctx.accountId, items });
    return items.map(() => ({ ok: true, batchRequestId: 'mock-batch' }));
  }

  async fetchOrders(): Promise<PagedResult<ExternalOrder>> {
    const base: ExternalOrder[] = [
      {
        externalId: 'PKG-1001', orderNumber: 'ORD-1001', status: 'Created', orderedAt: new Date('2026-10-29T10:00:00Z'),
        customer: { name: 'Ayşe Y.' }, currency: 'TRY', grandTotal: 558,
        items: [{ externalId: 'L1', barcode: '8690000000011', sku: 'DEMO-TS-S', name: 'Pamuklu Tişört S', quantity: 2, unitPrice: 279, lineTotal: 558, commission: 60 }],
        raw: {},
      },
    ];
    const list = MockAdapter.extraOrders.length ? MockAdapter.extraOrders : base;
    return { items: list, total: list.length };
  }
}
