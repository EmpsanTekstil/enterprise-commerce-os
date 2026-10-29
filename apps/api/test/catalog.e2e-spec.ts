/** Görsel yükleme (doğrulama, küçültme, sıralama, silme) ve kategori ağacı + kanal eşleştirme testleri. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Katalog: görseller ve kategoriler (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let productId: string;
  const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD ?? 'Admin123!';
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();

  beforeAll(async () => {
    process.env.STORAGE_MODE = 'local';
    process.env.LOCAL_STORAGE_DIR = '/tmp/eco-test-storage';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password })).body.accessToken;
    const p = await request(app.getHttpServer()).post('/api/v1/products').set(auth()).send({ name: 'Görsel Test Ürünü', variants: [{ sku: `IMG-${Date.now()}` }] }).expect(201);
    productId = p.body.id;
  });
  afterAll(async () => { await app.close(); });

  it('küçük görseli reddeder', async () => {
    const r = await request(app.getHttpServer()).post(`/api/v1/products/${productId}/images`).set(auth()).attach('file', await png(300, 300), 'kucuk.png').expect(400);
    expect(r.body.message).toContain('500px');
  });

  it('görsel dışı dosyayı reddeder', async () => {
    await request(app.getHttpServer()).post(`/api/v1/products/${productId}/images`).set(auth()).attach('file', Buffer.from('merhaba'), { filename: 'a.txt', contentType: 'text/plain' }).expect(400);
  });

  let ids: string[] = [];
  it('büyük görseli küçülterek yükler ve sıraya ekler', async () => {
    const r1 = await request(app.getHttpServer()).post(`/api/v1/products/${productId}/images`).set(auth()).attach('file', await png(3000, 1500), 'buyuk.png').expect(201);
    expect(r1.body.width).toBe(2000); expect(r1.body.height).toBe(1000); expect(r1.body.sortOrder).toBe(0);
    const r2 = await request(app.getHttpServer()).post(`/api/v1/products/${productId}/images`).set(auth()).attach('file', await png(800, 800), 'ikinci.png').expect(201);
    expect(r2.body.sortOrder).toBe(1);
    ids = [r1.body.id, r2.body.id];
    const p = await request(app.getHttpServer()).get(`/api/v1/products/${productId}`).set(auth());
    expect(p.body.images.map((i: { id: string }) => i.id)).toEqual(ids);
    const ready = await request(app.getHttpServer()).get(`/api/v1/products/${productId}/readiness`).set(auth());
    expect(ready.body.missing).not.toContain('En az 1 ürün görseli');
  });

  it('sıralamayı değiştirir ve geçersiz listeyi reddeder', async () => {
    const r = await request(app.getHttpServer()).patch(`/api/v1/products/${productId}/images/order`).set(auth()).send({ imageIds: [ids[1], ids[0]] }).expect(200);
    expect(r.body.map((i: { id: string }) => i.id)).toEqual([ids[1], ids[0]]);
    await request(app.getHttpServer()).patch(`/api/v1/products/${productId}/images/order`).set(auth()).send({ imageIds: [ids[0]] }).expect(400);
  });

  it('görseli siler', async () => {
    await request(app.getHttpServer()).delete(`/api/v1/products/${productId}/images/${ids[0]}`).set(auth()).expect(200);
    const p = await request(app.getHttpServer()).get(`/api/v1/products/${productId}`).set(auth());
    expect(p.body.images).toHaveLength(1);
  });

  let catId: string; let subId: string;
  it('kategori ağacı oluşturur ve yeniden adlandırır', async () => {
    const c = await request(app.getHttpServer()).post('/api/v1/categories').set(auth()).send({ name: `Giyim ${Date.now()}` }).expect(201);
    catId = c.body.id;
    const s = await request(app.getHttpServer()).post('/api/v1/categories').set(auth()).send({ name: 'Tişört', parentId: catId }).expect(201);
    subId = s.body.id;
    expect(s.body.path).toBe(`${c.body.name} > Tişört`);
    await request(app.getHttpServer()).patch(`/api/v1/categories/${catId}`).set(auth()).send({ name: 'Tekstil' }).expect(200);
    const tree = await request(app.getHttpServer()).get('/api/v1/categories').set(auth());
    expect(tree.body.find((x: { id: string }) => x.id === subId).path).toBe('Tekstil > Tişört');
    await request(app.getHttpServer()).delete(`/api/v1/categories/${catId}`).set(auth()).expect(400); // alt kategorisi var
  });

  it('kanal kategorisini eşleştirir (yalnızca yaprak)', async () => {
    const acc = await request(app.getHttpServer()).post('/api/v1/channels/accounts').set(auth()).send({ channelCode: 'mock', label: 'Kategori Test', credentials: { apiKey: 'test' }, isDemo: true }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/sync/accounts/${acc.body.id}/run`).set(auth()).send({ type: 'CATEGORY_PULL' }).expect(201);
    const leaf = await request(app.getHttpServer()).get(`/api/v1/categories/channel/search?accountId=${acc.body.id}&q=Tişört`).set(auth()).expect(200);
    expect(leaf.body[0].path).toBe('Giyim > Tişört');
    const parent = await request(app.getHttpServer()).get(`/api/v1/categories/channel/search?accountId=${acc.body.id}&q=Giyim&leafOnly=false`).set(auth());
    const giyim = parent.body.find((x: { isLeaf: boolean }) => !x.isLeaf);
    await request(app.getHttpServer()).post('/api/v1/categories/mappings').set(auth()).send({ categoryId: subId, accountId: acc.body.id, channelCategoryId: giyim.id }).expect(400);
    const m = await request(app.getHttpServer()).post('/api/v1/categories/mappings').set(auth()).send({ categoryId: subId, accountId: acc.body.id, channelCategoryId: leaf.body[0].id }).expect(201);
    expect(m.body.channelCategory.externalId).toBe('11');
    const list = await request(app.getHttpServer()).get(`/api/v1/categories/mappings/${acc.body.id}`).set(auth());
    expect(list.body).toHaveLength(1);
    await request(app.getHttpServer()).delete(`/api/v1/channels/accounts/${acc.body.id}`).set(auth()).expect(200);
  });
});
