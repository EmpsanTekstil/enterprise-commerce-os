import {
  AdapterContext, BatchStatus, CapabilityMatrix, ChannelAdapter, ChannelAttributeDef, ExternalBrand, ExternalAdMetric, ExternalCampaign, ExternalCategory, ExternalOrder, ExternalProduct, ExternalQuestion, ExternalReturn, PagedResult, PushResult,
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
  /** Testler için: createProducts ile gönderilenler */
  static created: ExternalProduct[] = [];
  /** Testler için: batch sonucu (varsayılan: hepsi başarılı; barkodu '...FAIL' ile bitenler başarısız) */
  static batchDone = true;
  static returns: ExternalReturn[] = [];
  static shipmentUpdates: { id: string; data: unknown }[] = [];
  static questions: ExternalQuestion[] = [];
  static answers: { id: string; text: string }[] = [];
  static campaignUpdates: { id: string; data: unknown }[] = [];
  static returnActions: { id: string; action: string; items: string[] }[] = [];

  readonly capabilities: CapabilityMatrix = {
    'products.read': { status: 'supported' }, 'products.create': { status: 'supported' }, 'products.update': { status: 'supported' },
    'stock.update': { status: 'supported' }, 'price.update': { status: 'supported' }, 'orders.read': { status: 'supported' },
    'shipping.update': { status: 'supported' }, 'returns.read': { status: 'supported' }, 'returns.update': { status: 'supported' },
    'questions.read': { status: 'supported' }, 'questions.answer': { status: 'supported' }, 'reviews.read': { status: 'unsupported' },
    'reviews.reply': { status: 'unsupported' }, 'ads.reports': { status: 'unsupported' }, 'ads.create': { status: 'unsupported' },
    'ads.budget': { status: 'unsupported' }, 'ads.pause': { status: 'unsupported' }, 'categories.read': { status: 'supported' }, webhooks: { status: 'supported' },
  };

  async testConnection(ctx: AdapterContext) {
    return ctx.credentials.apiKey === 'test' ? { ok: true, message: 'Test kanalı bağlı' } : { ok: false, message: 'apiKey "test" olmalı' };
  }

  async fetchCategoryAttributes(_ctx: AdapterContext, categoryExternalId: string): Promise<ChannelAttributeDef[]> {
    if (categoryExternalId !== '11') return [];
    return [
      { id: '338', name: 'Renk', required: true, allowCustom: false, varianter: true, values: [{ id: '1', name: 'Siyah' }, { id: '2', name: 'Beyaz' }] },
      { id: '343', name: 'Beden', required: true, allowCustom: true, varianter: true, values: [{ id: '10', name: 'S' }, { id: '11', name: 'M' }] },
      { id: '47', name: 'Materyal', required: false, allowCustom: true, varianter: false },
    ];
  }
  async fetchAttributeValues(_ctx: AdapterContext, _c: string, attributeId: string) {
    return attributeId === '338' ? [{ id: '1', name: 'Siyah' }, { id: '2', name: 'Beyaz' }, { id: '3', name: 'Kırmızı' }] : [];
  }
  async findBrands(_ctx: AdapterContext, name: string): Promise<ExternalBrand[]> {
    return name.toLowerCase().includes('demo') ? [{ externalId: '777', name: 'DemoMarka' }] : [];
  }
  async createProducts(_ctx: AdapterContext, products: ExternalProduct[]): Promise<PushResult[]> {
    MockAdapter.created.push(...products);
    return products.map((p) => ({ ok: true, externalId: p.barcode ?? p.externalId, batchRequestId: 'mock-batch-' + products.length }));
  }
  async checkBatch(): Promise<BatchStatus> {
    return { done: MockAdapter.batchDone, items: MockAdapter.created.map((p) => { const b = p.barcode ?? p.externalId; return { externalId: b, ok: !b.endsWith('FAIL'), errors: b.endsWith('FAIL') ? ['Görsel boyutu uygun değil'] : [] }; }) };
  }

  async updateShipment(_c: AdapterContext, id: string, data: unknown): Promise<PushResult> { MockAdapter.shipmentUpdates.push({ id, data }); return { ok: true }; }
  parseWebhook(payload: unknown): ExternalOrder[] { const b = payload as { orders?: ExternalOrder[] }; return (b.orders ?? []).map((o) => ({ ...o, orderedAt: new Date(o.orderedAt) })); }
  async fetchQuestions(): Promise<PagedResult<ExternalQuestion>> { return { items: MockAdapter.questions, total: MockAdapter.questions.length }; }
  async answerQuestion(_c: AdapterContext, id: string, text: string): Promise<PushResult> { MockAdapter.answers.push({ id, text }); return { ok: true }; }
  async fetchCampaigns(): Promise<ExternalCampaign[]> { return [{ externalId: 'CMP-1', name: 'Tişört Sponsorlu', type: 'sponsored_products', status: 'ACTIVE', dailyBudget: 200, raw: {} }, { externalId: 'CMP-2', name: 'Zayıf Kampanya', type: 'sponsored_products', status: 'ACTIVE', dailyBudget: 100, raw: {} }]; }
  async fetchAdMetrics(_c: AdapterContext, from: Date): Promise<ExternalAdMetric[]> {
    const d = new Date(from); d.setHours(0, 0, 0, 0);
    return [
      { campaignExternalId: 'CMP-1', date: d, productExternalId: '8690000000011', impressions: 5000, clicks: 150, spend: 180, orders: 9, sales: 2511 },
      { campaignExternalId: 'CMP-2', date: d, impressions: 3000, clicks: 90, spend: 95, orders: 0, sales: 0 },
    ];
  }
  async updateCampaign(_c: AdapterContext, id: string, data: unknown): Promise<PushResult> { MockAdapter.campaignUpdates.push({ id, data }); return { ok: true }; }
  async fetchReturns(): Promise<PagedResult<ExternalReturn>> { return { items: MockAdapter.returns, total: MockAdapter.returns.length }; }
  async approveReturn(_c: AdapterContext, id: string, items: string[]): Promise<PushResult> { MockAdapter.returnActions.push({ id, action: 'approve', items }); return { ok: true }; }
  async rejectReturn(_c: AdapterContext, id: string, items: string[]): Promise<PushResult> { MockAdapter.returnActions.push({ id, action: 'reject', items }); return { ok: true }; }
  async fetchReturnRejectReasons() { return [{ id: '1651', name: 'Ürün satıcıya ulaşmadı' }]; }

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
