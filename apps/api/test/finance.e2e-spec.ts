/** Fiyat kuralları + öneri + onay akışı, finans özeti/Excel, otomasyon kuralları + bildirimler. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { MockAdapter } from '../src/integrations/mock/mock.adapter';

describe('Fiyat, finans, otomasyon (e2e)', () => {
  let app: INestApplication; let token: string; let accountId: string; let productId: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (p: string, b?: unknown) => request(app.getHttpServer()).post(`/api/v1${p}`).set(auth()).send(b as object);
  const get = (p: string) => request(app.getHttpServer()).get(`/api/v1${p}`).set(auth());

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await post('/auth/login', { email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password: process.env.ADMIN_PASSWORD ?? 'Admin123!' })).body.accessToken;
    MockAdapter.pushed = []; MockAdapter.extraOrders = [];
    accountId = (await post('/channels/accounts', { channelCode: 'mock', label: 'Finans Test', credentials: { apiKey: 'test' } })).body.id; // isDemo=false → raporlara girer
    await post(`/channels/accounts/${accountId}/test`);
    await post(`/sync/accounts/${accountId}/run`, { type: 'PRODUCT_PULL' });
    await post('/listings/accept-suggestions', { accountId });
    await post(`/sync/accounts/${accountId}/run`, { type: 'ORDER_PULL' });
    productId = (await get('/products?q=DEMO-TS-S')).body.items[0].id;
  });
  afterAll(async () => { await request(app.getHttpServer()).delete(`/api/v1/channels/accounts/${accountId}`).set(auth()); await app.close(); });

  it('fiyat kuralı oluşturur; ürün kârlılığı dökümü ve önerilen fiyat', async () => {
    await post('/pricing/rules', { name: 'Genel', commissionPercent: 15, shippingCost: 40, packagingCost: 5, otherCostPercent: 2, targetMarginPercent: 25, minPrice: 50, maxPrice: 2000 }).expect(201);
    await post('/pricing/rules', { name: 'Geçersiz', commissionPercent: 1, shippingCost: 0, packagingCost: 0, otherCostPercent: 0, targetMarginPercent: 10, minPrice: 500, maxPrice: 100 }).expect(400);
    const r = await get(`/pricing/products/${productId}`).expect(200);
    const row = r.body.rows.find((x: { sku: string }) => x.sku === 'DEMO-TS-S');
    expect(row.breakdown.netProfit).toBeDefined(); expect(row.suggestedPrice.price).toBeGreaterThan(row.cost);
  });

  it('öneri üretir, onaylanınca ilan fiyatı değişir ve kanala PRICE_PUSH gider; ret yalnızca işaretler', async () => {
    const g = await post('/pricing/proposals/generate', { channelAccountId: accountId, minDiffPercent: 0 }).expect(201);
    expect(g.body.created).toBeGreaterThan(0);
    const list = await get('/pricing/proposals').expect(200);
    const [a, b] = list.body as { id: string; proposedPrice: string; listingId: string }[];
    expect(a).toBeDefined();
    const before = MockAdapter.pushed.length;
    await post('/pricing/proposals/approve', { ids: [a.id] }).expect(201);
    expect(MockAdapter.pushed.length).toBe(before + 1);
    const applied = await get('/pricing/proposals?status=APPLIED');
    expect(applied.body.some((x: { id: string }) => x.id === a.id)).toBe(true);
    if (b) { await post('/pricing/proposals/reject', { ids: [b.id] }).expect(201); expect((await get('/pricing/proposals?status=REJECTED')).body.some((x: { id: string }) => x.id === b.id)).toBe(true); }
    expect((await get('/pricing/proposals')).body.some((x: { id: string }) => x.id === a.id)).toBe(false);
  });

  it('finans özeti gerçek siparişi içerir; Excel indirilebilir', async () => {
    const s = await get('/finance/summary').expect(200);
    expect(s.body.totals.orders).toBeGreaterThanOrEqual(1);
    expect(s.body.channels.some((c: { label: string }) => c.label === 'Finans Test')).toBe(true);
    const t = await get('/finance/stock-turnover').expect(200);
    expect(t.body.some((x: { sku: string }) => x.sku === 'DEMO-TS-S')).toBe(false); // demo ürünler raporlara girmez
    expect(Array.isArray(t.body)).toBe(true);
    const x = await get('/finance/export').expect(200);
    expect(x.headers['content-disposition']).toContain('rapor-');
  });

  it('otomasyon: varsayılan kurallar, değerlendirme, bildirim merkezi, okundu', async () => {
    const d = await post('/automations/install-defaults').expect(201);
    expect(d.body.created).toBeGreaterThan(0);
    const rules = await get('/automations').expect(200);
    const q = rules.body.find((r: { trigger: string }) => r.trigger === 'new_question');
    await post(`/automations/${q.id}/toggle`, { isEnabled: false }).expect(201);
    MockAdapter.questions = [{ externalId: 'AQ-1', text: 'Otomasyon testi sorusu?', askedAt: new Date(), status: 'WAITING_FOR_ANSWER', raw: {} }];
    await post(`/sync/accounts/${accountId}/run`, { type: 'QUESTION_PULL' });
    const ev = await post('/automations/evaluate').expect(201);
    expect(ev.body.evaluated).toBeGreaterThan(0);
    const notes = await get('/notifications?unread=1').expect(200);
    expect(notes.body.length).toBeGreaterThan(0);
    expect(notes.body.some((n: { title: string }) => n.title.includes('yeni sipariş'))).toBe(true);
    expect(notes.body.some((n: { title: string }) => n.title.includes('yeni müşteri sorusu'))).toBe(false); // kapatılmış kural tetiklenmez
    const c1 = (await get('/notifications/unread-count')).body.count;
    await post('/notifications/read', {}).expect(201);
    expect((await get('/notifications/unread-count')).body.count).toBe(0); expect(c1).toBeGreaterThan(0);
    MockAdapter.questions = [];
  });
});
