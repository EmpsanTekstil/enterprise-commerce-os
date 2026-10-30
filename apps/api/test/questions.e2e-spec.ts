/** Müşteri soruları: çekme, ürünle eşleme, SLA, taslak, şablon, onaylı gönderim, AI kapalıyken açık hata. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { MockAdapter } from '../src/integrations/mock/mock.adapter';

describe('Müşteri soruları (e2e)', () => {
  let app: INestApplication; let token: string; let accountId: string; let qid: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (p: string, b?: unknown) => request(app.getHttpServer()).post(`/api/v1${p}`).set(auth()).send(b as object);
  const get = (p: string) => request(app.getHttpServer()).get(`/api/v1${p}`).set(auth());

  beforeAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await post('/auth/login', { email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password: process.env.ADMIN_PASSWORD ?? 'Admin123!' })).body.accessToken;
    MockAdapter.questions = []; MockAdapter.answers = [];
    accountId = (await post('/channels/accounts', { channelCode: 'mock', label: 'Soru Test', credentials: { apiKey: 'test' }, isDemo: true })).body.id;
    await post(`/sync/accounts/${accountId}/run`, { type: 'PRODUCT_PULL' });
    await post('/listings/accept-suggestions', { accountId });
  });
  afterAll(async () => { await request(app.getHttpServer()).delete(`/api/v1/channels/accounts/${accountId}`).set(auth()); MockAdapter.questions = []; await app.close(); });

  it('soruları çeker, ürünle eşler, gecikmişi işaretler', async () => {
    MockAdapter.questions = [
      { externalId: 'Q-1', productExternalId: '8690000000011', customerName: 'M. K.', text: 'Bu tişörtün kumaşı ne?', askedAt: new Date(Date.now() - 48 * 3_600_000), status: 'WAITING_FOR_ANSWER', raw: {} },
      { externalId: 'Q-2', customerName: 'A. B.', text: 'Kargo ne zaman?', askedAt: new Date(), status: 'ANSWERED', raw: {} },
    ];
    const r = await post(`/sync/accounts/${accountId}/run`, { type: 'QUESTION_PULL' }).expect(201);
    expect(r.body.result).toMatchObject({ created: 2 });
    const l = await get(`/questions?accountId=${accountId}&status=PENDING`).expect(200);
    expect(l.body.total).toBe(1);
    const q = l.body.items[0]; qid = q.id;
    expect(q.product.name).toContain('Tişört'); expect(q.overdue).toBe(true); expect(q.canReplyViaApi).toBe(true);
    expect(l.body.counts.ANSWERED).toBeGreaterThanOrEqual(1);
  });

  it('AI anahtarı yoksa açık hata, sahte taslak yok', async () => {
    const r = await post(`/questions/${qid}/ai-draft`).expect(503);
    expect(r.body.message).toContain('ANTHROPIC_API_KEY');
  });

  it('şablon oluşturur, taslak kaydeder, onaylayıp kanala gönderir; ikinci gönderim reddedilir', async () => {
    const t = await post('/questions/templates', { title: 'Kumaş', body: 'Merhaba, ürünümüz %100 pamuktur. İyi günler dileriz.' }).expect(201);
    expect((await get('/questions/templates/all')).body.some((x: { id: string }) => x.id === t.body.id)).toBe(true);
    const d = await post(`/questions/${qid}/draft`, { text: t.body.body, source: 'TEMPLATE' }).expect(201);
    expect((await get(`/questions?accountId=${accountId}&status=DRAFTED`)).body.total).toBe(1);
    expect(MockAdapter.answers).toHaveLength(0); // taslak gönderilmez
    await post(`/questions/${qid}/send`, { responseId: d.body.id }).expect(201);
    expect(MockAdapter.answers.at(-1)).toMatchObject({ id: 'Q-1' });
    expect((await get(`/questions?accountId=${accountId}&status=ANSWERED`)).body.total).toBe(2);
    await post(`/questions/${qid}/send`, { responseId: d.body.id }).expect(400);
    await post(`/questions/${qid}/draft`, { text: 'tekrar' }).expect(400);
  });

  it('kısa cevap reddedilir', async () => {
    MockAdapter.questions = [{ externalId: 'Q-3', text: 'Beden?', askedAt: new Date(), status: 'WAITING_FOR_ANSWER', raw: {} }];
    await post(`/sync/accounts/${accountId}/run`, { type: 'QUESTION_PULL' });
    const q = (await get(`/questions?accountId=${accountId}&status=OPEN`)).body.items[0];
    const d = await post(`/questions/${q.id}/draft`, { text: 'Evet' }).expect(201);
    const r = await post(`/questions/${q.id}/send`, { responseId: d.body.id }).expect(400);
    expect(r.body.message).toContain('10 karakter');
  });
});
