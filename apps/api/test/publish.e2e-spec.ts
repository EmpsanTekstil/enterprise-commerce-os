/** Kanala ürün yayınlama: hazırlık kontrolü, özellik çözümleme, marka, gönderim, toplu sonuç takibi (ACTIVE / REJECTED). */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { MockAdapter } from '../src/integrations/mock/mock.adapter';

describe('Ürün yayınlama (e2e)', () => {
  let app: INestApplication;
  let token: string; let accountId: string; let productId: string; let okVariant: string; let badVariant: string; let failVariant: string; let catId: string;
  const t = Date.now();
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (path: string, body?: unknown) => request(app.getHttpServer()).post(`/api/v1${path}`).set(auth()).send(body as object);

  beforeAll(async () => {
    process.env.STORAGE_MODE = 'local'; process.env.LOCAL_STORAGE_DIR = '/tmp/eco-test-storage';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await post('/auth/login', { email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password: process.env.ADMIN_PASSWORD ?? 'Admin123!' })).body.accessToken;
    MockAdapter.created = []; MockAdapter.batchDone = true;
    accountId = (await post('/channels/accounts', { channelCode: 'mock', label: 'Yayın Test', credentials: { apiKey: 'test' }, isDemo: true })).body.id;
    await post(`/channels/accounts/${accountId}/test`);
    await post(`/sync/accounts/${accountId}/run`, { type: 'CATEGORY_PULL' });
    catId = (await post('/categories', { name: `Yayın ${t}` })).body.id;
    const p = await post('/products', {
      name: 'Yayın Test Tişört', brand: 'DemoMarka', model: `YT-${t}`, categoryId: catId, vatRate: 10, originCountry: 'Türkiye',
      description: 'Bu ürün yayın testi için oluşturulmuştur ve yeterince uzun bir açıklamaya sahiptir.',
      specs: { Kumaş: 'Pamuk' },
      variants: [
        { sku: `YT-${t}-S`, barcode: `869${t}01`, color: 'Siyah', size: 'S', listPrice: 199, initialStock: 4 },
        { sku: `YT-${t}-MOR`, barcode: `869${t}02`, color: 'Mor', size: 'M', listPrice: 199, initialStock: 2 },
        { sku: `YT-${t}-F`, barcode: `869${t}FAIL`, color: 'Beyaz', size: 'M', listPrice: 199, initialStock: 1 },
      ],
    }).expect(201);
    productId = p.body.id;
    okVariant = p.body.variants.find((v: { sku: string }) => v.sku.endsWith('-S')).id;
    badVariant = p.body.variants.find((v: { sku: string }) => v.sku.endsWith('-MOR')).id;
    failVariant = p.body.variants.find((v: { sku: string }) => v.sku.endsWith('-F')).id;
  });
  afterAll(async () => { await request(app.getHttpServer()).delete(`/api/v1/channels/accounts/${accountId}`).set(auth()); await app.close(); });

  it('eksikleri gönderim yapmadan listeler', async () => {
    const r = await post('/listings/prepare', { accountId, variantIds: [okVariant] }).expect(201);
    expect(r.body[0].problems).toEqual(expect.arrayContaining([expect.stringContaining('Kategori eşleştirilmemiş'), expect.stringContaining('En az 1 görsel')]));
  });

  it('kategori eşleştirme + görsel sonrası hazır olur; listeden seçilmesi gereken özellik eşleşmezse engeller', async () => {
    const leaf = (await request(app.getHttpServer()).get(`/api/v1/categories/channel/search?accountId=${accountId}&q=Tişört`).set(auth())).body[0];
    await post('/categories/mappings', { categoryId: catId, accountId, channelCategoryId: leaf.id, attributeMap: { '47': { source: 'spec', specKey: 'Kumaş' } } }).expect(201);
    const png = await sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer();
    await request(app.getHttpServer()).post(`/api/v1/products/${productId}/images`).set(auth()).attach('file', png, 'a.png').expect(201);
    const r = await post('/listings/prepare', { accountId, variantIds: [okVariant, badVariant] }).expect(201);
    const ok = r.body[0]; const bad = r.body[1];
    expect(ok.problems).toEqual([]);
    expect(ok.product.brandExternalId).toBe('777');
    expect(ok.product.categoryExternalId).toBe('11');
    expect(ok.product.originCountryCode).toBe('TR');
    expect(ok.product.channelAttributes).toEqual(expect.arrayContaining([
      { attributeId: '338', valueId: '1' },            // Renk: Siyah → liste değeri
      { attributeId: '343', valueId: '10' },             // Beden: S listede var → liste değeri
      { attributeId: '47', customValue: 'Pamuk' },      // Materyal: kural ile teknik özellikten
    ]));
    expect(bad.problems).toEqual([expect.stringContaining('Zorunlu özellik eksik: Renk')]);
  });

  it('yayınlar: hazır olan PENDING, engellenen ERROR', async () => {
    const r = await post('/listings/publish', { accountId, variantIds: [okVariant, badVariant] }).expect(201);
    expect(r.body).toMatchObject({ requested: 2, sent: 1, failed: 0 });
    expect(r.body.blocked[0].sku).toBe(`YT-${t}-MOR`);
    expect(MockAdapter.created).toHaveLength(1);
    const l = (await request(app.getHttpServer()).get(`/api/v1/listings?accountId=${accountId}`).set(auth())).body.items;
    expect(l.find((x: { variantId: string }) => x.variantId === okVariant)).toMatchObject({ status: 'PENDING', batchRequestId: expect.any(String), externalId: `869${t}01` });
    expect(l.find((x: { variantId: string }) => x.variantId === badVariant).status).toBe('ERROR');
  });

  it('toplu sonuç: bekliyorsa dokunmaz, tamamlanınca ACTIVE / REJECTED yapar', async () => {
    MockAdapter.batchDone = false;
    await post(`/sync/accounts/${accountId}/run`, { type: 'BATCH_CHECK' }).expect(201);
    let l = (await request(app.getHttpServer()).get(`/api/v1/listings?accountId=${accountId}`).set(auth())).body.items;
    expect(l.find((x: { variantId: string }) => x.variantId === okVariant).status).toBe('PENDING');
    MockAdapter.batchDone = true;
    await post('/listings/publish', { accountId, variantIds: [failVariant] }).expect(201);
    const r = await post(`/sync/accounts/${accountId}/run`, { type: 'BATCH_CHECK' }).expect(201);
    expect(r.body.result).toMatchObject({ approved: 1, rejected: 1 });
    l = (await request(app.getHttpServer()).get(`/api/v1/listings?accountId=${accountId}`).set(auth())).body.items;
    expect(l.find((x: { variantId: string }) => x.variantId === okVariant).status).toBe('ACTIVE');
    const rej = l.find((x: { variantId: string }) => x.variantId === failVariant);
    expect(rej.status).toBe('REJECTED'); expect(rej.lastError).toContain('Görsel boyutu');
  });

  it('kanal-özel başlık/fiyat düzenlenebilir ve yayına yansır', async () => {
    const l = (await request(app.getHttpServer()).get(`/api/v1/listings?accountId=${accountId}`).set(auth())).body.items.find((x: { variantId: string }) => x.variantId === okVariant);
    await request(app.getHttpServer()).patch(`/api/v1/listings/${l.id}`).set(auth()).send({ title: 'Kanal Başlığı', price: 249, salePrice: 229 }).expect(200);
    const r = await post('/listings/prepare', { accountId, variantIds: [okVariant] });
    expect(r.body[0].product).toMatchObject({ title: 'Kanal Başlığı', price: 249, salePrice: 229 });
    await request(app.getHttpServer()).patch(`/api/v1/listings/${l.id}`).set(auth()).send({ title: 'x'.repeat(101) }).expect(400);
  });
});
