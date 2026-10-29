/** İade akışı: kanaldan iade çekme, siparişe bağlama, onay/ret (kanal API), kontrol sonrası stoğa alma (bir kez). */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MockAdapter } from '../src/integrations/mock/mock.adapter';

describe('İadeler (e2e)', () => {
  let app: INestApplication; let token: string; let accountId: string; let returnId: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (path: string, body?: unknown) => request(app.getHttpServer()).post(`/api/v1${path}`).set(auth()).send(body as object);
  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set(auth());
  const stockOf = async (sku: string) => {
    const p = (await get(`/products?q=${sku}`)).body.items.find((x: { variants: { sku: string }[] }) => x.variants.some((v) => v.sku === sku));
    const d = (await get(`/products/${p.id}`)).body; const v = d.variants.find((x: { sku: string }) => x.sku === sku);
    return v.balances.reduce((s: number, b: { onHand: number; reserved: number }) => s + b.onHand - b.reserved, 0);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await post('/auth/login', { email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password: process.env.ADMIN_PASSWORD ?? 'Admin123!' })).body.accessToken;
    MockAdapter.extraOrders = []; MockAdapter.returns = []; MockAdapter.returnActions = [];
    accountId = (await post('/channels/accounts', { channelCode: 'mock', label: 'İade Test', credentials: { apiKey: 'test' }, isDemo: true })).body.id;
    await post(`/sync/accounts/${accountId}/run`, { type: 'ORDER_PULL' }); // PKG-1001: 2 x DEMO-TS-S
  });
  afterAll(async () => { await request(app.getHttpServer()).delete(`/api/v1/channels/accounts/${accountId}`).set(auth()); MockAdapter.returns = []; await app.close(); });

  it('iade talebini çeker ve siparişe bağlar; eşleşmeyeni raporlar', async () => {
    MockAdapter.returns = [
      { externalId: 'CLM-1', orderNumber: 'ORD-1001', status: 'WaitingInAction', reason: 'Beden uymadı', customerName: 'Ayşe Y.', requestedAt: new Date(), items: [{ claimItemId: 'ci-1', orderLineExternalId: 'L1', barcode: '8690000000011', sku: 'DEMO-TS-S', name: 'Pamuklu Tişört S', quantity: 2, status: 'WaitingInAction' }], raw: {} },
      { externalId: 'CLM-X', orderNumber: 'YOK-999', status: 'Created', requestedAt: new Date(), items: [], raw: {} },
    ];
    const r = await post(`/sync/accounts/${accountId}/run`, { type: 'RETURN_PULL' }).expect(201);
    expect(r.body.result).toMatchObject({ created: 1, unmatched: 1 });
    const list = await get(`/returns?accountId=${accountId}`).expect(200);
    expect(list.body.total).toBe(1);
    returnId = list.body.items[0].id;
    expect(list.body.items[0]).toMatchObject({ status: 'REQUESTED', channelStatus: 'WaitingInAction', canActViaApi: true, order: { orderNumber: 'ORD-1001' } });
  });

  it('stoğa alma: onaydan önce de yapılabilir, ikinci kez yapılamaz', async () => {
    const before = await stockOf('DEMO-TS-S');
    const r = await post(`/returns/${returnId}/restock`).expect(201);
    expect(r.body.restored).toBe(2);
    expect(await stockOf('DEMO-TS-S')).toBe(before + 2);
    await post(`/returns/${returnId}/restock`).expect(400);
    expect(await stockOf('DEMO-TS-S')).toBe(before + 2);
  });

  it('kanal üzerinden onaylar; tekrar onay reddedilir', async () => {
    await post(`/returns/${returnId}/approve`).expect(201);
    expect(MockAdapter.returnActions.at(-1)).toMatchObject({ id: 'CLM-1', action: 'approve', items: ['ci-1'] });
    expect((await get(`/returns?accountId=${accountId}`)).body.items[0].status).toBe('APPROVED');
    await post(`/returns/${returnId}/approve`).expect(400);
  });

  it('ret sebepleri listelenir ve ret talebi gönderilir', async () => {
    MockAdapter.returns = [{ externalId: 'CLM-2', orderNumber: 'ORD-1001', status: 'WaitingInAction', requestedAt: new Date(), items: [{ claimItemId: 'ci-2', barcode: '8690000000011', quantity: 1 }], raw: {} }];
    await post(`/sync/accounts/${accountId}/run`, { type: 'RETURN_PULL' });
    const reasons = await get(`/returns/reject-reasons/${accountId}`).expect(200);
    expect(reasons.body[0].id).toBe('1651');
    const id = (await get(`/returns?accountId=${accountId}&status=REQUESTED`)).body.items[0].id;
    await post(`/returns/${id}/reject`, { reasonId: '1651', description: 'Paket elimize ulaşmadı' }).expect(201);
    expect(MockAdapter.returnActions.at(-1)).toMatchObject({ id: 'CLM-2', action: 'reject' });
  });

  it('sipariş RETURNED olunca stok otomatik eklenmez (iade akışı yönetir)', async () => {
    const before = await stockOf('DEMO-TS-S');
    MockAdapter.extraOrders = [{ externalId: 'PKG-1001', orderNumber: 'ORD-1001', status: 'Returned', orderedAt: new Date('2026-10-29T10:00:00Z'), currency: 'TRY', grandTotal: 558, items: [{ externalId: 'L1', barcode: '8690000000011', sku: 'DEMO-TS-S', name: 'Pamuklu Tişört S', quantity: 2, unitPrice: 279, lineTotal: 558 }], raw: {} }];
    await post(`/sync/accounts/${accountId}/run`, { type: 'ORDER_PULL' });
    expect(await stockOf('DEMO-TS-S')).toBe(before);
    MockAdapter.extraOrders = [];
  });
});
