/**
 * Senkronizasyon uçtan uca testi (Test Kanalı / mock adaptör ile):
 * hesap ekle → bağlantı testi → kategori çek → ürün çek → eşleştirme → sipariş çek → stok düşümü → tekrar çek (çift düşüm yok)
 * → iptal → stok iadesi → stok gönderme.
 * Gerekli seed: SEED_DEMO=1 ENABLE_MOCK_CHANNEL=1 npm run db:seed
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { MockAdapter } from '../src/integrations/mock/mock.adapter';

describe('Senkronizasyon (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let accountId: string;
  const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD ?? 'Admin123!';
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const r = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(201);
    token = r.body.accessToken;
    // Önceki koşulardan kalan test hesaplarını temizle
    const list = await request(app.getHttpServer()).get('/api/v1/channels/accounts').set(auth());
    for (const a of list.body.filter((x: { channel: { code: string }; label: string }) => x.channel.code === 'mock' && x.label === 'Test Mağazası')) {
      await request(app.getHttpServer()).delete(`/api/v1/channels/accounts/${a.id}`).set(auth());
    }
    MockAdapter.pushed = []; MockAdapter.extraOrders = [];
  });
  afterAll(async () => { await app.close(); });

  /** Varyantın satılabilir stoğu (onHand - reserved, tüm depolar) */
  const stockOf = async (sku: string): Promise<number> => {
    const r = await request(app.getHttpServer()).get(`/api/v1/products?q=${sku}`).set(auth()).expect(200);
    const p = r.body.items.find((x: { variants: { sku: string }[] }) => x.variants.some((v) => v.sku === sku));
    if (!p) throw new Error(`Ürün bulunamadı: ${sku}`);
    const d = await request(app.getHttpServer()).get(`/api/v1/products/${p.id}`).set(auth()).expect(200);
    const v = d.body.variants.find((x: { sku: string }) => x.sku === sku);
    return v.balances.reduce((s: number, b: { onHand: number; reserved: number }) => s + b.onHand - b.reserved, 0);
  };

  it('test kanalı hesabı ekler ve bağlantıyı doğrular', async () => {
    const r = await request(app.getHttpServer()).post('/api/v1/channels/accounts').set(auth())
      .send({ channelCode: 'mock', label: 'Test Mağazası', credentials: { apiKey: 'test' }, isDemo: true }).expect(201);
    accountId = r.body.id;
    expect(r.body.credentialSummary.apiKey).not.toBe('test'); // maskelenmiş
    const t = await request(app.getHttpServer()).post(`/api/v1/channels/accounts/${accountId}/test`).set(auth()).expect(201);
    expect(t.body.ok).toBe(true);
  });

  it('yanlış anahtarla bağlantı testi başarısız olur ve gizlenmez', async () => {
    const r = await request(app.getHttpServer()).post('/api/v1/channels/accounts').set(auth())
      .send({ channelCode: 'mock', label: 'Bozuk', credentials: { apiKey: 'yanlis' } }).expect(201);
    const t = await request(app.getHttpServer()).post(`/api/v1/channels/accounts/${r.body.id}/test`).set(auth()).expect(201);
    expect(t.body.ok).toBe(false);
    const acc = await request(app.getHttpServer()).get('/api/v1/channels/accounts').set(auth());
    expect(acc.body.find((a: { id: string }) => a.id === r.body.id).status).toBe('ERROR');
    await request(app.getHttpServer()).delete(`/api/v1/channels/accounts/${r.body.id}`).set(auth()).expect(200);
  });

  it('kategori ağacını çeker', async () => {
    const r = await request(app.getHttpServer()).post(`/api/v1/sync/accounts/${accountId}/run`).set(auth()).send({ type: 'CATEGORY_PULL' }).expect(201);
    expect(r.body.status).toBe('SUCCESS');
  });

  it('ürünleri içe aktarır ve eşleştirme önerir (otomatik birleştirme yok)', async () => {
    const r = await request(app.getHttpServer()).post(`/api/v1/sync/accounts/${accountId}/run`).set(auth()).send({ type: 'PRODUCT_PULL' }).expect(201);
    expect(r.body.status).toBe('SUCCESS');
    const l = await request(app.getHttpServer()).get(`/api/v1/listings?accountId=${accountId}`).set(auth()).expect(200);
    expect(l.body.total).toBe(3);
    expect(l.body.items.every((x: { variantId: string | null }) => x.variantId === null)).toBe(true);
    const byBarcode = l.body.items.find((x: { externalId: string }) => x.externalId === '8690000000011');
    expect(byBarcode.matchSuggestions[0].reason).toBe('Barkod eşleşti');
    const bySku = l.body.items.find((x: { externalId: string }) => x.externalId === '8698888888888');
    expect(bySku.matchSuggestions[0].reason).toBe('SKU eşleşti');
  });

  it('yüksek güvenli önerileri topluca kabul eder, SKU eşleşmesini elle bağlar, kalanı ürüne çevirir', async () => {
    const acc = await request(app.getHttpServer()).post('/api/v1/listings/accept-suggestions').set(auth()).send({ accountId }).expect(201);
    expect(acc.body.linked).toBe(1);
    let l = await request(app.getHttpServer()).get(`/api/v1/listings?accountId=${accountId}`).set(auth());
    const bySku = l.body.items.find((x: { externalId: string }) => x.externalId === '8698888888888');
    await request(app.getHttpServer()).post(`/api/v1/listings/${bySku.id}/link`).set(auth()).send({ variantId: bySku.matchSuggestions[0].variantId }).expect(201);
    const only = l.body.items.find((x: { externalId: string }) => x.externalId === '8699999999999');
    const p = await request(app.getHttpServer()).post(`/api/v1/listings/${only.id}/create-product`).set(auth()).expect(201);
    expect(p.body.variants[0].barcode).toBe('8699999999999');
    expect(await stockOf('MOCK-ONLY-1')).toBe(3);
    l = await request(app.getHttpServer()).get(`/api/v1/listings?accountId=${accountId}`).set(auth());
    expect(l.body.items.every((x: { variantId: string | null }) => x.variantId !== null)).toBe(true);
  });

  it('toplu katalog aktarımı: SKU\'su var olan ilanlar mevcut varyanta bağlanır, yeni ürün açılmaz', async () => {
    const acc2 = (await request(app.getHttpServer()).post('/api/v1/channels/accounts').set(auth()).send({ channelCode: 'mock', label: 'Toplu Aktarım', credentials: { apiKey: 'test' }, isDemo: true })).body.id;
    await request(app.getHttpServer()).post(`/api/v1/sync/accounts/${acc2}/run`).set(auth()).send({ type: 'PRODUCT_PULL' }).expect(201);
    const r = await request(app.getHttpServer()).post('/api/v1/listings/import-catalog').set(auth()).send({ accountId: acc2 }).expect(201);
    expect(r.body).toMatchObject({ listings: 3, products: 0, variants: 0, linkedExisting: 3, skipped: 0 });
    const l = await request(app.getHttpServer()).get(`/api/v1/listings?accountId=${acc2}`).set(auth());
    expect(l.body.items.every((x: { variantId: string | null }) => x.variantId !== null)).toBe(true);
    const again = await request(app.getHttpServer()).post('/api/v1/listings/import-catalog').set(auth()).send({ accountId: acc2 }).expect(201);
    expect(again.body.listings).toBe(0);
    await request(app.getHttpServer()).delete(`/api/v1/channels/accounts/${acc2}`).set(auth());
  });

  it('siparişi çeker ve stoğu bir kez düşer; tekrar çekince çift düşmez', async () => {
    const before = await stockOf('DEMO-TS-S');
    const r1 = await request(app.getHttpServer()).post(`/api/v1/sync/accounts/${accountId}/run`).set(auth()).send({ type: 'ORDER_PULL' }).expect(201);
    expect(r1.body.status).toBe('SUCCESS');
    expect(await stockOf('DEMO-TS-S')).toBe(before - 2);
    await request(app.getHttpServer()).post(`/api/v1/sync/accounts/${accountId}/run`).set(auth()).send({ type: 'ORDER_PULL' }).expect(201);
    expect(await stockOf('DEMO-TS-S')).toBe(before - 2);
    const orders = await request(app.getHttpServer()).get(`/api/v1/orders?accountId=${accountId}`).set(auth()).expect(200);
    expect(orders.body.total).toBe(1);
    expect(orders.body.items[0].status).toBe('NEW');
    const detail = await request(app.getHttpServer()).get(`/api/v1/orders/${orders.body.items[0].id}`).set(auth()).expect(200);
    expect(detail.body.profitEstimate.net).toBe(558 - 60 - 2 * 120);
  });

  it('iptal edilen sipariş stoğu bir kez geri ekler', async () => {
    const before = await stockOf('DEMO-TS-S');
    MockAdapter.extraOrders = [{
      externalId: 'PKG-1001', orderNumber: 'ORD-1001', status: 'Cancelled', orderedAt: new Date('2026-10-29T10:00:00Z'), currency: 'TRY', grandTotal: 558,
      items: [{ externalId: 'L1', barcode: '8690000000011', sku: 'DEMO-TS-S', name: 'Pamuklu Tişört S', quantity: 2, unitPrice: 279, lineTotal: 558, commission: 60 }], raw: {},
    }];
    await request(app.getHttpServer()).post(`/api/v1/sync/accounts/${accountId}/run`).set(auth()).send({ type: 'ORDER_PULL' }).expect(201);
    expect(await stockOf('DEMO-TS-S')).toBe(before + 2);
    await request(app.getHttpServer()).post(`/api/v1/sync/accounts/${accountId}/run`).set(auth()).send({ type: 'ORDER_PULL' }).expect(201);
    expect(await stockOf('DEMO-TS-S')).toBe(before + 2);
    const orders = await request(app.getHttpServer()).get(`/api/v1/orders?accountId=${accountId}&status=CANCELLED`).set(auth());
    expect(orders.body.total).toBe(1);
    MockAdapter.extraOrders = [];
  });

  it('stok ve fiyatı kanala gönderir', async () => {
    const r = await request(app.getHttpServer()).post(`/api/v1/sync/accounts/${accountId}/run`).set(auth()).send({ type: 'STOCK_PUSH' }).expect(201);
    expect(r.body.status).toBe('SUCCESS');
    const last = MockAdapter.pushed.at(-1)!;
    expect(last.accountId).toBe(accountId);
    const sent = last.items as { barcode: string; stock: number }[];
    expect(sent.find((i) => i.barcode === '8690000000011')!.stock).toBe(await stockOf('DEMO-TS-S'));
  });

  it('iş geçmişi görünür', async () => {
    const r = await request(app.getHttpServer()).get(`/api/v1/sync/jobs?accountId=${accountId}`).set(auth()).expect(200);
    expect(r.body.length).toBeGreaterThanOrEqual(5);
    expect(r.body.every((j: { status: string }) => j.status === 'SUCCESS')).toBe(true);
  });
});
