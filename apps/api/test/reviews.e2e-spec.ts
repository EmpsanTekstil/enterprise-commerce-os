/** Yorumlar: Excel içe aktarma, puana göre sınıflandırma, özet, tekrarlayan sorunlar, taslak + panelden gönderildi; AI kapalıyken açık hata; veri kalitesi raporu. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Yorumlar ve AI stüdyosu (e2e)', () => {
  let app: INestApplication; let token: string; let accountId: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (p: string, b?: unknown) => request(app.getHttpServer()).post(`/api/v1${p}`).set(auth()).send(b as object);
  const get = (p: string) => request(app.getHttpServer()).get(`/api/v1${p}`).set(auth());
  const csv = (s: string) => Buffer.from('﻿' + s, 'utf8');

  beforeAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await post('/auth/login', { email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password: process.env.ADMIN_PASSWORD ?? 'Admin123!' })).body.accessToken;
    accountId = (await post('/channels/accounts', { channelCode: 'mock', label: 'Yorum Test', credentials: { apiKey: 'test' }, isDemo: true })).body.id;
  });
  afterAll(async () => { await request(app.getHttpServer()).delete(`/api/v1/channels/accounts/${accountId}`).set(auth()); await app.close(); });

  it('Excel raporunu içe aktarır ve ürünle eşler', async () => {
    const file = csv('Yorum ID;Barkod;Puan;Başlık;Yorum;Müşteri;Tarih\nR1;8690000000011;5;Harika;Kumaşı çok kaliteli;A. B.;12.10.2026\nR2;8690000000011;1;Kötü;Bedeni küçük geldi, iade ettim;C. D.;13.10.2026\nR3;;3;;İdare eder;;\nR4;;9;;Hatalı puan;;\n');
    const r = await request(app.getHttpServer()).post(`/api/v1/reviews/import/${accountId}`).set(auth()).attach('file', file, 'yorumlar.csv').expect(201);
    expect(r.body).toMatchObject({ total: 4, created: 3 }); expect(r.body.errors[0].error).toContain('1-5');
    const l = await get(`/reviews?accountId=${accountId}`).expect(200);
    expect(l.body.total).toBe(3);
    expect(l.body.items.find((x: { externalId: string }) => x.externalId === 'R1').product.name).toContain('Tişört');
    expect(l.body.summary.count).toBeGreaterThanOrEqual(3);
  });

  it('puana göre sınıflandırır; tekrarlayan sorunlar listelenir', async () => {
    await post('/reviews/classify-by-rating').expect(201);
    const neg = await get(`/reviews?accountId=${accountId}&sentiment=NEGATIVE`).expect(200);
    expect(neg.body.total).toBe(1);
    const ins = await get('/reviews/insights').expect(200);
    expect(ins.body[0]).toMatchObject({ count: expect.any(Number) });
  });

  it('AI kapalıyken analiz ve taslak açık hata verir', async () => {
    await post('/reviews/analyze', { limit: 5 }).expect(503);
    const id = (await get(`/reviews?accountId=${accountId}`)).body.items[0].id;
    await post(`/reviews/${id}/ai-draft`).expect(503);
  });

  it('insan taslağı + panelden gönderildi işareti; API olmayan kanalda doğrudan gönderim reddedilir', async () => {
    const id = (await get(`/reviews?accountId=${accountId}&sentiment=NEGATIVE`)).body.items[0].id;
    const d = await post(`/reviews/${id}/draft`, { text: 'Üzgünüz, beden tablosu için mesaj kanalından yardımcı olalım.' }).expect(201);
    await post(`/reviews/${id}/send`, { responseId: d.body.id }).expect(400); // mock kanal reviews.reply desteklemez → açık hata
    await post(`/reviews/${id}/send`, { responseId: d.body.id, markOnly: true }).expect(201);
    await post(`/reviews/${id}/send`, { responseId: d.body.id, markOnly: true }).expect(400);
  });

  it('veri kalitesi raporu ve AI durum/geçmiş uç noktaları', async () => {
    const dq = await get('/ai/data-quality').expect(200);
    expect(dq.body.checked).toBeGreaterThan(0); expect(Array.isArray(dq.body.items)).toBe(true);
    const st = await get('/ai/status').expect(200);
    expect(st.body.enabled).toBe(false);
    const h = await get('/ai/history').expect(200);
    expect(h.body.some((x: { status: string }) => x.status === 'FAILED')).toBe(true); // başarısız denemeler de kayıtlı
  });
});
