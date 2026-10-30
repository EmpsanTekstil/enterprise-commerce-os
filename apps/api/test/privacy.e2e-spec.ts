/** KVKK veri saklama: ayar doğrulama, önizleme, maskeleme/ham veri silme (idempotent), denetim kaydı. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { MASKED_NAME } from '../src/modules/privacy/privacy.service';

describe('KVKK veri saklama (e2e)', () => {
  let app: INestApplication; let token: string; let accountId: string; let orderId: string; let prisma: PrismaService;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (path: string, body?: unknown) => request(app.getHttpServer()).post(`/api/v1${path}`).set(auth()).send(body as object);
  const put = (path: string, body?: unknown) => request(app.getHttpServer()).put(`/api/v1${path}`).set(auth()).send(body as object);
  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set(auth());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init(); prisma = app.get(PrismaService);
    token = (await post('/auth/login', { email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password: process.env.ADMIN_PASSWORD ?? 'Admin123!' })).body.accessToken;
    accountId = (await post('/channels/accounts', { channelCode: 'mock', label: 'KVKK Test', credentials: { apiKey: 'test' }, isDemo: true })).body.id;
    await post(`/sync/accounts/${accountId}/run`, { type: 'ORDER_PULL' });
    orderId = (await get(`/orders?accountId=${accountId}`)).body.items[0].id;
    // Siparişi 3 yıl geriye çek ki saklama süresi dolsun
    await prisma.order.update({ where: { id: orderId }, data: { orderedAt: new Date(Date.now() - 3 * 365 * 86_400_000), customerName: 'Ayşe Yılmaz', customerEmail: 'ayse@example.com', customerPhone: '05551112233', rawSnapshot: { buyer: 'Ayşe' } } });
  });
  afterAll(async () => {
    await put('/privacy/retention', {});
    await request(app.getHttpServer()).delete(`/api/v1/channels/accounts/${accountId}`).set(auth()); await app.close();
  });

  it('varsayılan kapalı; geçersiz süre reddedilir; ham veri süresi maskelemeden uzun olamaz', async () => {
    const r = await get('/privacy/retention').expect(200);
    expect(r.body).toMatchObject({ piiMaskAfterDays: null, rawPurgeAfterDays: null });
    await put('/privacy/retention', { piiMaskAfterDays: 0 }).expect(400);
    await put('/privacy/retention', { piiMaskAfterDays: 365, rawPurgeAfterDays: 400 }).expect(400);
    const p0 = await get('/privacy/retention/preview').expect(200);
    expect(p0.body).toMatchObject({ orders: 0, raw: 0, cutoffMask: null });
  });

  it('süre dolan sipariş maskelenir, ham veri silinir, tekrar çalıştırma hiçbir şeyi değiştirmez', async () => {
    const s = await put('/privacy/retention', { piiMaskAfterDays: 730, rawPurgeAfterDays: 365 }).expect(200);
    expect(s.body).toMatchObject({ piiMaskAfterDays: 730, rawPurgeAfterDays: 365 });
    const p = await get('/privacy/retention/preview').expect(200);
    expect(p.body.orders).toBeGreaterThanOrEqual(1); expect(p.body.raw).toBeGreaterThanOrEqual(1);
    const r = await post('/privacy/retention/run').expect(201);
    expect(r.body.orders).toBeGreaterThanOrEqual(1);
    const o = await get(`/orders/${orderId}`).expect(200);
    expect(o.body.customerName).toBe(MASKED_NAME); expect(o.body.customerEmail).toBeNull(); expect(o.body.customerPhone).toBeNull(); expect(o.body.shippingAddress).toBeNull();
    expect(o.body.grandTotal).toBeDefined();
    const db = await prisma.order.findUnique({ where: { id: orderId } });
    expect(db!.rawSnapshot).toBeNull(); expect(db!.piiMaskedAt).not.toBeNull();
    const again = await post('/privacy/retention/run').expect(201);
    expect(again.body).toMatchObject({ orders: 0, returns: 0, questions: 0, reviews: 0, raw: 0 });
    expect((await get('/privacy/retention')).body.piiLastRunAt).not.toBeNull();
    const audit = await get('/audit-log?entityType=Organization').expect(200);
    expect(audit.body.some((a: { action: string }) => a.action === 'privacy.run')).toBe(true);
  });
});
