/** Reklam: API'den çekme (mock), Excel içe aktarma, KPI'lar, kural tabanlı analiz, API ile yönetilen/yönetilmeyen kampanya ayrımı. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { MockAdapter } from '../src/integrations/mock/mock.adapter';

describe('Reklam (e2e)', () => {
  let app: INestApplication; let token: string; let accountId: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (p: string, b?: unknown) => request(app.getHttpServer()).post(`/api/v1${p}`).set(auth()).send(b as object);
  const get = (p: string) => request(app.getHttpServer()).get(`/api/v1${p}`).set(auth());
  const csv = (s: string) => Buffer.from('﻿' + s, 'utf8');

  beforeAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await post('/auth/login', { email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password: process.env.ADMIN_PASSWORD ?? 'Admin123!' })).body.accessToken;
    MockAdapter.campaignUpdates = [];
    accountId = (await post('/channels/accounts', { channelCode: 'mock', label: 'Reklam Test', credentials: { apiKey: 'test' }, isDemo: true })).body.id;
    await post(`/sync/accounts/${accountId}/run`, { type: 'PRODUCT_PULL' }); await post('/listings/accept-suggestions', { accountId });
  });
  afterAll(async () => { await request(app.getHttpServer()).delete(`/api/v1/channels/accounts/${accountId}`).set(auth()); await app.close(); });

  it('API ile kampanya ve metrik çeker; KPI hesaplar; ürün bazında kırılım', async () => {
    const r = await post(`/sync/accounts/${accountId}/run`, { type: 'ADS_PULL' }).expect(201);
    expect(r.body.result).toMatchObject({ campaigns: 2, metrics: 2 });
    await post(`/sync/accounts/${accountId}/run`, { type: 'ADS_PULL' }).expect(201); // tekrar: çift kayıt yok
    const d = await get('/ads/dashboard').expect(200);
    const c1 = d.body.campaigns.find((c: { campaign: { name: string } }) => c.campaign.name === 'Tişört Sponsorlu');
    expect(c1.spend).toBe(180); expect(c1.roas).toBeCloseTo(2511 / 180, 2); expect(c1.acos).toBeCloseTo((180 / 2511) * 100, 2); expect(c1.ctr).toBeCloseTo(3, 2); expect(c1.campaign.isManagedViaApi).toBe(true);
    expect(d.body.total.spend).toBe(275);
    expect(d.body.products.some((p: { sku: string; spend: number }) => p.sku === 'DEMO-TS-S' && p.spend === 180)).toBe(true);
  });

  it('Excel raporu içe aktarır (API olmayan kanal senaryosu)', async () => {
    const file = csv('Tarih;Kampanya;Barkod;Gösterim;Tıklama;Harcama;Sipariş;Satış Tutarı;Günlük Bütçe\n28.10.2026;Excel Kampanya;8690000000011;1000;40;60,50;3;900;150\n29.10.2026;Excel Kampanya;;1200;45;70;2;600;150\n29.10.2026;;;;;10;;;\n');
    const r = await request(app.getHttpServer()).post(`/api/v1/ads/import/${accountId}`).set(auth()).attach('file', file, 'reklam.csv').expect(201);
    expect(r.body).toMatchObject({ total: 3, saved: 2 }); expect(r.body.errors).toHaveLength(1);
    const d = await get('/ads/dashboard').expect(200);
    const c = d.body.campaigns.find((x: { campaign: { name: string } }) => x.campaign.name === 'Excel Kampanya');
    expect(c.spend).toBe(130.5); expect(c.campaign.source).toBe('IMPORT'); expect(c.campaign.isManagedViaApi).toBe(false);
  });

  it('kural tabanlı analiz: 0 siparişli kampanya yüksek öncelikli', async () => {
    const a = await get('/ads/analysis?targetAcos=25').expect(200);
    const weak = a.body.findings.find((f: { campaign: string }) => f.campaign === 'Zayıf Kampanya');
    expect(weak.severity).toBe('high'); expect(weak.issue).toContain('0 sipariş');
  });

  it('API ile yönetilen kampanya durdurulur/bütçesi değişir; Excel kampanyasında reddedilir', async () => {
    const d = await get('/ads/dashboard');
    const api = d.body.campaigns.find((x: { campaign: { name: string } }) => x.campaign.name === 'Zayıf Kampanya').campaign;
    const imp = d.body.campaigns.find((x: { campaign: { name: string } }) => x.campaign.name === 'Excel Kampanya').campaign;
    const u = await post(`/ads/campaigns/${api.id}`, { status: 'PAUSED', dailyBudget: 50 }).expect(201);
    expect(u.body.status).toBe('PAUSED'); expect(MockAdapter.campaignUpdates.at(-1)).toMatchObject({ id: 'CMP-2', data: { status: 'PAUSED', dailyBudget: 50 } });
    const r = await post(`/ads/campaigns/${imp.id}`, { status: 'PAUSED' }).expect(400);
    expect(r.body.message).toContain('kanal panelinden');
  });

  it('AI analizi anahtar yoksa açık hata', async () => { await post('/ads/ai-analysis', {}).expect(503); });
});
