/**
 * Uçtan uca test: giriş → ürün oluştur → listele → hazırlık kontrolü → yetkisiz erişim.
 * Gerçek PostgreSQL gerekir (DATABASE_URL). Çalıştırma: npm run test:e2e -w @eco/api
 * Önce: npm run prisma:deploy -w @eco/api && npm run db:seed
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';

describe('Enterprise Commerce OS API (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD ?? 'Admin123!';
  const sku = `E2E-${Date.now()}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => { await app.close(); });

  it('sağlık kontrolü açık', async () => {
    const r = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(r.body.database).toBe('ok');
  });

  it('token olmadan ürünlere erişilemez', async () => {
    await request(app.getHttpServer()).get('/api/v1/products').expect(401);
  });

  it('giriş yapar', async () => {
    const r = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password }).expect(201);
    expect(r.body.accessToken).toBeTruthy();
    token = r.body.accessToken;
  });

  it('yanlış şifreyi reddeder', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'yanlis-sifre' }).expect(401);
  });

  let productId: string;
  it('ürün oluşturur (varyant + açılış stoğu)', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'E2E Test Ürünü', brand: 'TestMarka', vatRate: 20, variants: [{ sku, barcode: '8690000009999', costPrice: 100, listPrice: 199, initialStock: 7 }] })
      .expect(201);
    productId = r.body.id;
    expect(r.body.variants[0].sku).toBe(sku);
    expect(r.body.variants[0].balances[0].onHand).toBe(7);
  });

  it('aynı SKU ile ikinci ürün reddedilir', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Kopya', variants: [{ sku }] })
      .expect(409);
  });

  it('ürün listesinde arama çalışır', async () => {
    const r = await request(app.getHttpServer()).get(`/api/v1/products?q=${sku}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(r.body.items.some((p: { id: string }) => p.id === productId)).toBe(true);
    expect(r.body.items.find((p: { id: string }) => p.id === productId).totalStock).toBe(7);
  });

  it('yayın hazırlık kontrolü eksikleri listeler', async () => {
    const r = await request(app.getHttpServer()).get(`/api/v1/products/${productId}/readiness`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(r.body.ready).toBe(false);
    expect(r.body.missing).toEqual(expect.arrayContaining(['Kategori']));
  });

  it('dashboard özeti gerçek sayılarla döner', async () => {
    const r = await request(app.getHttpServer()).get('/api/v1/dashboard/summary').set('Authorization', `Bearer ${token}`).expect(200);
    expect(typeof r.body.products.active).toBe('number');
    expect(Array.isArray(r.body.integrations.accounts)).toBe(true);
  });

  it('kanal listesi adaptör yeteneklerini içerir', async () => {
    const r = await request(app.getHttpServer()).get('/api/v1/channels').set('Authorization', `Bearer ${token}`).expect(200);
    const ty = r.body.find((c: { code: string }) => c.code === 'trendyol');
    expect(ty.capabilities['orders.read'].status).toBe('supported');
  });

  it('ürünü arşivler', async () => {
    await request(app.getHttpServer()).delete(`/api/v1/products/${productId}`).set('Authorization', `Bearer ${token}`).expect(200);
  });
});
