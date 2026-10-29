/** Toplu ürün / fiyat / stok yükleme: şablon, önizleme (hata raporu), uygulama. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Toplu işlemler (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const t = Date.now();
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const csv = (s: string) => Buffer.from('﻿' + s, 'utf8');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = (await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password: process.env.ADMIN_PASSWORD ?? 'Admin123!' })).body.accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('şablon indirir', async () => {
    const r = await request(app.getHttpServer()).get('/api/v1/bulk/products/template').set(auth()).expect(200);
    expect(r.headers['content-disposition']).toContain('urun-yukleme-sablonu.xlsx');
  });

  it('önizleme: hataları satır bazında raporlar, geçerli satırları uygular', async () => {
    const file = csv([
      'Ürün Grubu;Ürün Adı *;Marka;Kategori;SKU *;Barkod;Renk;Beden;Alış Maliyeti;Satış Fiyatı;Stok;KDV %',
      `GRP-${t};Toplu Tişört;Markam;Giyim > Toplu > Tişört;BLK-${t}-S;869${t}1;Siyah;S;100;249,90;5;10`,
      `GRP-${t};Toplu Tişört;Markam;Giyim > Toplu > Tişört;BLK-${t}-M;869${t}2;Siyah;M;100;249,90;7;10`,
      `;Hatalı Satır;;;;;;;abc;;;`,
      `;Tekil Ürün;;;BLK-${t}-TEK;;;;50;99;1;20`,
    ].join('\n'));
    const p = await request(app.getHttpServer()).post('/api/v1/bulk/products/preview').set(auth()).attach('file', file, 'urunler.csv').expect(201);
    expect(p.body.total).toBe(4); expect(p.body.valid).toBe(3); expect(p.body.invalid).toBe(1);
    const bad = p.body.rows.find((r: { row: number }) => r.row === 4);
    expect(bad.errors.join(' ')).toContain('SKU zorunlu');
    expect(p.body.rows[0].action).toBe('create');

    const valid = p.body.rows.filter((r: { errors: string[] }) => r.errors.length === 0).map((r: { data: unknown }) => r.data);
    const a = await request(app.getHttpServer()).post('/api/v1/bulk/products/apply').set(auth()).send({ rows: valid }).expect(201);
    expect(a.body).toMatchObject({ created: 2, updated: 0, variantsCreated: 3, errors: [] });

    const list = await request(app.getHttpServer()).get(`/api/v1/products?q=BLK-${t}-`).set(auth());
    const grp = list.body.items.find((x: { name: string }) => x.name === 'Toplu Tişört');
    expect(grp.variants).toHaveLength(2);
    expect(grp.totalStock).toBe(12);
    expect(grp.category.path).toBe('Giyim > Toplu > Tişört');
  });

  it('ikinci yüklemede mevcut SKU günceller, yeni varyant ekler', async () => {
    const file = csv(`urun_grubu;urun_adi;sku;satis_fiyati;stok\nGRP-${t};Toplu Tişört;BLK-${t}-S;259;99\nGRP-${t};Toplu Tişört;BLK-${t}-L;259;3\n`);
    const p = await request(app.getHttpServer()).post('/api/v1/bulk/products/preview').set(auth()).attach('file', file, 'u.csv');
    expect(p.body.rows.map((r: { action: string }) => r.action)).toEqual(['update', 'create']);
    const a = await request(app.getHttpServer()).post('/api/v1/bulk/products/apply').set(auth()).send({ rows: p.body.rows.map((r: { data: unknown }) => r.data) }).expect(201);
    expect(a.body).toMatchObject({ created: 0, updated: 1, variantsCreated: 1, variantsUpdated: 1 });
    const list = await request(app.getHttpServer()).get(`/api/v1/products?q=BLK-${t}-`).set(auth());
    const grp = list.body.items.find((x: { name: string }) => x.name === 'Toplu Tişört');
    expect(grp.variants).toHaveLength(3);
    expect(grp.totalStock).toBe(15); // mevcut varyantın stoğu toplu ürün yüklemesinde değişmez (5+7+3)
  });

  it('toplu stok: mutlak değer, hareket defteriyle', async () => {
    const p = await request(app.getHttpServer()).post('/api/v1/bulk/stock/preview').set(auth()).attach('file', csv(`SKU;Yeni Stok;Depo Kodu\nBLK-${t}-S;20;\nYOK-${t};5;\nBLK-${t}-M;1;DEPOYOK\n`), 's.csv');
    expect(p.body.valid).toBe(1); expect(p.body.invalid).toBe(2);
    const a = await request(app.getHttpServer()).post('/api/v1/bulk/stock/apply').set(auth()).send({ rows: p.body.rows.filter((r: { errors: string[] }) => !r.errors.length).map((r: { data: unknown }) => r.data) }).expect(201);
    expect(a.body.updated).toBe(1);
    const list = await request(app.getHttpServer()).get(`/api/v1/products?q=BLK-${t}-S`).set(auth());
    expect(list.body.items[0].totalStock).toBe(20 + 7 + 3);
  });

  it('toplu fiyat', async () => {
    const p = await request(app.getHttpServer()).post('/api/v1/bulk/prices/preview').set(auth()).attach('file', csv(`sku;satis_fiyati\nBLK-${t}-TEK;129,50\n`), 'f.csv');
    expect(p.body.valid).toBe(1);
    await request(app.getHttpServer()).post('/api/v1/bulk/prices/apply').set(auth()).send({ rows: p.body.rows.map((r: { data: unknown }) => r.data) }).expect(201);
    const list = await request(app.getHttpServer()).get(`/api/v1/products?q=BLK-${t}-TEK`).set(auth());
    expect(Number(list.body.items[0].variants[0].listPrice)).toBe(129.5);
  });
});
