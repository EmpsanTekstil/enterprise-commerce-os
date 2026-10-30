import { AmazonAdapter } from './amazon.adapter';

type Route = (url: string, init?: RequestInit) => Response | undefined;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const token: Route = (u) => (u === 'https://api.amazon.com/auth/o2/token' ? json({ access_token: 'tok', expires_in: 3600 }) : undefined);
function mockFetch(...routes: Route[]) {
  const calls: { url: string; method: string; body?: string }[] = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input); calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
    for (const r of [token, ...routes]) { const res = r(url, init); if (res) return res; }
    throw new Error(`beklenmeyen istek: ${url}`);
  });
  return calls;
}

const TSV = 'item-name\tseller-sku\tprice\tquantity\tasin1\tstatus\timage-url\nKupa 350ml\tKUPA-1\t149.90\t12\tB0TEST001\tActive\thttps://img/kupa.jpg\nTabak\tTABAK-2\t\t0\tB0TEST002\tInactive\t\n';
const SP = 'https://sellingpartnerapi-eu.amazon.com';
const reportRoutes: Route = (u, init) => {
  if (u === `${SP}/reports/2021-06-30/reports` && init?.method === 'POST') return json({ reportId: 'R1' });
  if (u === `${SP}/reports/2021-06-30/reports/R1`) return json({ processingStatus: 'DONE', reportDocumentId: 'D1' });
  if (u === `${SP}/reports/2021-06-30/documents/D1`) return json({ url: 'https://doc.test/r1.tsv' });
  if (u === 'https://doc.test/r1.tsv') return new Response(TSV, { status: 200 });
  return undefined;
};

describe('Amazon adaptörü (ağ gerektirmeyen)', () => {
  const a = new AmazonAdapter();
  const ctx = { accountId: 'acc', credentials: { sellerId: 's', clientId: 'c', clientSecret: 'x', refreshToken: 'r' }, settings: { reportPollMs: 1 } };
  const adsCtx = { accountId: 'acc2', credentials: { ...ctx.credentials, adsClientId: 'ac', adsClientSecret: 'as', adsRefreshToken: 'ar', adsProfileId: '123' }, settings: {} };
  afterEach(() => jest.restoreAllMocks());

  it('rapor TSV ayrıştırma ürün listesi üretir', async () => {
    const calls = mockFetch(reportRoutes);
    const r = await a.fetchProducts(ctx);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/reports/2021-06-30/reports'))).toBe(true);
    expect(r.nextCursor).toBeUndefined(); expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ externalId: 'KUPA-1', sku: 'KUPA-1', title: 'Kupa 350ml', price: 149.9, salePrice: 149.9, stock: 12, status: 'active', images: ['https://img/kupa.jpg'], attributes: { ASIN: 'B0TEST001' } });
    expect(r.items[1]).toMatchObject({ sku: 'TABAK-2', status: 'paused', stock: 0, images: [] }); expect(r.items[1].price).toBeUndefined();
  });

  it("cursor 'report:' rapor oluşturmadan devam eder", async () => {
    const calls = mockFetch(reportRoutes);
    const r = await a.fetchProducts(ctx, 'report:R1');
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/reports/2021-06-30/reports'))).toBe(false);
    expect(r.items).toHaveLength(2);
  });

  it('rapor hazır değilse cursor olarak report:{id} döner', async () => {
    mockFetch((u) => (u === `${SP}/reports/2021-06-30/reports/R1` ? json({ processingStatus: 'IN_PROGRESS' }) : undefined));
    const r = await a.fetchProducts(ctx, 'report:R1');
    expect(r.items).toEqual([]); expect(r.nextCursor).toBe('report:R1');
  });

  it('Ads kimlik eksikse açık hata', async () => {
    mockFetch();
    await expect(a.fetchCampaigns(ctx)).rejects.toThrow('adsClientId');
  });

  it('fetchCampaigns durum eşlemesi', async () => {
    const calls = mockFetch((u, init) => (u === 'https://advertising-api-eu.amazon.com/sp/campaigns/list' ? json({ campaigns: [
      { campaignId: '1', name: 'A', state: 'ENABLED', budget: { budget: 50, budgetType: 'DAILY' }, startDate: '2026-01-01' },
      { campaignId: '2', name: 'B', state: 'PAUSED', budget: { budget: 20 } },
      { campaignId: '3', name: 'C', state: 'ARCHIVED' },
    ] }) : undefined));
    const r = await a.fetchCampaigns(adsCtx);
    expect(r.map((c) => c.status)).toEqual(['ACTIVE', 'PAUSED', 'ARCHIVED']);
    expect(r[0]).toMatchObject({ externalId: '1', dailyBudget: 50 }); expect(r[0].startDate?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(calls.some((c) => c.url.endsWith('/sp/campaigns/list'))).toBe(true);
    const h = (fetch as jest.Mock).mock.calls.find((c) => String(c[0]).endsWith('/sp/campaigns/list'))![1].headers as Record<string, string>;
    expect(h['Amazon-Advertising-API-Scope']).toBe('123'); expect(h['Amazon-Advertising-API-ClientId']).toBe('ac'); expect(h['Content-Type']).toBe('application/vnd.spCampaign.v3+json');
  });

  it("updateShipment 'picking' ağ olmadan ok döner", async () => {
    const calls = mockFetch();
    const r = await a.updateShipment(ctx, 'ORD-1', { status: 'picking' });
    expect(r).toEqual({ ok: true, externalId: 'ORD-1' }); expect(calls).toHaveLength(0);
  });

  it("updateShipment 'shipped' confirmShipment gövdesi", async () => {
    const calls = mockFetch((u, init) => (u === `${SP}/orders/v0/orders/ORD-1/shipmentConfirmation` && init?.method === 'POST' ? new Response(null, { status: 204 }) : undefined));
    const r = await a.updateShipment(ctx, 'ORD-1', { status: 'shipped', trackingNumber: 'TK1', lines: [{ externalId: 'OI1', quantity: 2 }] });
    expect(r.ok).toBe(true);
    const body = JSON.parse(calls.find((c) => c.url.endsWith('/shipmentConfirmation'))!.body!);
    expect(body).toMatchObject({ marketplaceId: 'A33AVAJ2PDY3EV', packageDetail: { packageReferenceId: '1', carrierCode: 'Other', trackingNumber: 'TK1', orderItems: [{ orderItemId: 'OI1', quantity: 2 }] } });
  });
});
