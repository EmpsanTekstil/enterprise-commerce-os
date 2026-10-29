/** Paketleme akışı (kanala Picking/Invoiced bildirimi), webhook alıcısı (anahtar doğrulama, idempotent), stok/depo yönetimi ve mutabakat. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MockAdapter } from '../src/integrations/mock/mock.adapter';

describe('Paketleme, webhook ve stok (e2e)', () => {
  let app: INestApplication; let token: string; let accountId: string; let orderId: string; let webhookKey: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (path: string, body?: unknown) => request(app.getHttpServer()).post(`/api/v1${path}`).set(auth()).send(body as object);
  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set(auth());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await post('/auth/login', { email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password: process.env.ADMIN_PASSWORD ?? 'Admin123!' })).body.accessToken;
    MockAdapter.extraOrders = []; MockAdapter.shipmentUpdates = [];
    accountId = (await post('/channels/accounts', { channelCode: 'mock', label: 'Paket Test', credentials: { apiKey: 'test' }, isDemo: true })).body.id;
    await post(`/sync/accounts/${accountId}/run`, { type: 'ORDER_PULL' });
    orderId = (await get(`/orders?accountId=${accountId}`)).body.items[0].id;
  });
  afterAll(async () => { await request(app.getHttpServer()).delete(`/api/v1/channels/accounts/${accountId}`).set(auth()); await app.close(); });

  it('toplama ve faturalama bildirimi kanala gider, durum ilerler', async () => {
    const r1 = await post(`/orders/${orderId}/fulfill`, { action: 'picking' }).expect(201);
    expect(r1.body.status).toBe('PICKING');
    expect(MockAdapter.shipmentUpdates.at(-1)).toMatchObject({ id: 'PKG-1001', data: { status: 'picking', lines: [{ externalId: 'L1', quantity: 2 }] } });
    await post(`/orders/${orderId}/fulfill`, { action: 'invoiced' }).expect(400); // fatura no yok
    const r2 = await post(`/orders/${orderId}/fulfill`, { action: 'invoiced', invoiceNumber: 'FT2026000001', trackingNumber: 'TRK123' }).expect(201);
    expect(r2.body.status).toBe('PACKED');
    expect(r2.body.shipments[0].trackingNumber).toBe('TRK123');
    expect(r2.body.history.map((h: { toStatus: string }) => h.toStatus)).toEqual(['NEW', 'PICKING', 'PACKED']);
  });

  it('webhook anahtarı üretilir; yanlış anahtar reddedilir; doğru anahtarla sipariş güncellenir (idempotent)', async () => {
    const k = await post(`/channels/accounts/${accountId}/webhook-key`).expect(201);
    webhookKey = k.body.key; expect(k.body.url).toContain(`/webhooks/mock/${accountId}`);
    const payload = { orders: [{ externalId: 'PKG-1001', orderNumber: 'ORD-1001', status: 'Shipped', orderedAt: '2026-10-29T10:00:00Z', currency: 'TRY', grandTotal: 558, items: [{ externalId: 'L1', barcode: '8690000000011', sku: 'DEMO-TS-S', name: 'Pamuklu Tişört S', quantity: 2, unitPrice: 279, lineTotal: 558 }], shipment: { carrierName: 'Test Kargo', trackingNumber: 'TRK123' }, raw: {} }] };
    await request(app.getHttpServer()).post(`/api/v1/webhooks/mock/${accountId}`).set('x-api-key', 'yanlis').send(payload).expect(401);
    await request(app.getHttpServer()).post(`/api/v1/webhooks/mock/${accountId}`).send(payload).expect(401);
    const r = await request(app.getHttpServer()).post(`/api/v1/webhooks/mock/${accountId}`).set('x-api-key', webhookKey).send(payload).expect(201);
    expect(r.body).toMatchObject({ received: 1, updated: 1, created: 0 });
    const o = (await get(`/orders/${orderId}`)).body;
    expect(o.status).toBe('SHIPPED'); expect(o.shipments[0].carrierName).toBe('Test Kargo');
    await request(app.getHttpServer()).post(`/api/v1/webhooks/mock/${accountId}`).set('x-api-key', webhookKey).send(payload).expect(201);
    expect((await get(`/orders?accountId=${accountId}`)).body.total).toBe(1);
  });

  it('depo oluşturma, elle stok düzeltme, hareket geçmişi, kritik stok', async () => {
    const w = await post('/inventory/warehouses', { name: 'İkinci Depo', code: `d2-${Date.now() % 10000}` }).expect(201);
    expect(w.body.code).toMatch(/^D2-/);
    const p = (await get('/products?q=DEMO-TS-S')).body.items[0];
    const variantId = p.variants.find((v: { sku: string }) => v.sku === 'DEMO-TS-S').id;
    const a = await post('/inventory/adjust', { variantId, warehouseId: w.body.id, quantity: 7, reorderPoint: 10, note: 'Sayım' }).expect(201);
    expect(a.body).toMatchObject({ onHand: 7, reorderPoint: 10, available: 7 });
    const a2 = await post('/inventory/adjust', { variantId, warehouseId: w.body.id, delta: -2 }).expect(201);
    expect(a2.body.onHand).toBe(5);
    const mv = await get(`/inventory/movements/${variantId}`).expect(200);
    expect(mv.body[0]).toMatchObject({ type: 'ADJUSTMENT', quantity: -2 });
    const low = await get(`/inventory/balances?lowOnly=true&warehouseId=${w.body.id}`).expect(200);
    expect(low.body.items.some((b: { variantId: string; isLow: boolean }) => b.variantId === variantId && b.isLow)).toBe(true);
  });

  it('kanal stok politikası ve mutabakat', async () => {
    const pol = await request(app.getHttpServer()).put(`/api/v1/inventory/policies/${accountId}`).set(auth()).send({ sharePercent: 50, bufferQuantity: 1 }).expect(200);
    expect(pol.body).toMatchObject({ sharePercent: 50, bufferQuantity: 1 });
    await post(`/sync/accounts/${accountId}/run`, { type: 'PRODUCT_PULL' });
    await post('/listings/accept-suggestions', { accountId });
    const rec = await get('/inventory/reconciliation').expect(200);
    expect(typeof rec.body.mismatches).toBe('number');
    // Beklenen kanal stoğu = floor((satılabilir − tampon) × pay%)
    const p = (await get('/products?q=DEMO-TS-S')).body.items[0];
    const v = (await get(`/products/${p.id}`)).body.variants.find((x: { sku: string }) => x.sku === 'DEMO-TS-S');
    const available = v.balances.reduce((s: number, b: { onHand: number; reserved: number }) => s + b.onHand - b.reserved, 0);
    const expected = Math.floor(Math.max(0, available - 1) * 0.5);
    const item = rec.body.items.find((i: { sku: string; channel: string }) => i.sku === 'DEMO-TS-S' && i.channel.includes('Paket Test'));
    expect(item).toBeDefined();
    expect(item.expected).toBe(expected);
    expect(item.channelStock).toBe(10); // mock kanalın bildirdiği stok
  });
});
