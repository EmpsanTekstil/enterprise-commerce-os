/** Kullanıcı/rol yönetimi: oluşturma (geçici şifre), rol bazlı erişim kısıtı, son yönetici koruması, şifre sıfırlama, audit log. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';

describe('Kullanıcılar ve yetkiler (e2e)', () => {
  let app: INestApplication; let token: string; let staffToken: string; let staffId: string; let adminId: string;
  const t = Date.now();
  const auth = (tk = token) => ({ Authorization: `Bearer ${tk}` });
  const post = (p: string, b?: unknown, tk?: string) => request(app.getHttpServer()).post(`/api/v1${p}`).set(auth(tk)).send(b as object);
  const get = (p: string, tk?: string) => request(app.getHttpServer()).get(`/api/v1${p}`).set(auth(tk));

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const login = await post('/auth/login', { email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password: process.env.ADMIN_PASSWORD ?? 'Admin123!' });
    token = login.body.accessToken; adminId = login.body.user.id;
  });
  afterAll(async () => { await app.close(); });

  it('sipariş personeli oluşturur; geçici şifreyle giriş yapar; ürün yazma yetkisi yok', async () => {
    const roles = await get('/roles').expect(200);
    const staff = roles.body.find((r: { key: string }) => r.key === 'order_staff');
    const c = await post('/users', { email: `personel-${t}@ornek.com`, fullName: 'Sipariş Personeli', roleIds: [staff.id] }).expect(201);
    expect(c.body.tempPassword).toBeTruthy(); staffId = c.body.id;
    const l = await post('/auth/login', { email: `personel-${t}@ornek.com`, password: c.body.tempPassword }).expect(201);
    staffToken = l.body.accessToken;
    expect(l.body.user.permissions).toContain('orders.read'); expect(l.body.user.permissions).not.toContain('products.write');
    await get('/orders', staffToken).expect(200);
    const f = await post('/products', { name: 'Yetkisiz', variants: [{ sku: `X-${t}` }] }, staffToken).expect(403);
    expect(f.body.message).toContain('products.write');
    await get('/users', staffToken).expect(403);
  });

  it('kendi şifresini değiştirir', async () => {
    await post('/users/me/password', { current: 'yanlis', next: 'YeniSifre123' }, staffToken).expect(400);
    await post('/users/me/password', { current: (await post('/users/' + staffId + '/reset-password')).body.tempPassword, next: 'YeniSifre123' }, staffToken).expect(201);
    await post('/auth/login', { email: `personel-${t}@ornek.com`, password: 'YeniSifre123' }).expect(201);
  });

  it('son yönetici korunur; kullanıcı pasifleştirilince giriş yapamaz', async () => {
    const roles = await get('/roles');
    const staff = roles.body.find((r: { key: string }) => r.key === 'order_staff');
    await request(app.getHttpServer()).patch(`/api/v1/users/${adminId}`).set(auth()).send({ roleIds: [staff.id] }).expect(403);
    await request(app.getHttpServer()).patch(`/api/v1/users/${adminId}`).set(auth()).send({ isActive: false }).expect(403);
    await request(app.getHttpServer()).patch(`/api/v1/users/${staffId}`).set(auth()).send({ isActive: false }).expect(200);
    await post('/auth/login', { email: `personel-${t}@ornek.com`, password: 'YeniSifre123' }).expect(401);
  });

  it('rol yetkileri düzenlenir; admin rolü korunur; audit log kayıtlı', async () => {
    const roles = await get('/roles');
    const fin = roles.body.find((r: { key: string }) => r.key === 'finance'); const admin = roles.body.find((r: { key: string }) => r.key === 'admin');
    await request(app.getHttpServer()).put(`/api/v1/roles/${fin.id}/permissions`).set(auth()).send({ keys: ['finance.read', 'dashboard.read', 'orders.read'] }).expect(200);
    await request(app.getHttpServer()).put(`/api/v1/roles/${admin.id}/permissions`).set(auth()).send({ keys: [] }).expect(403);
    const perms = await get('/permissions').expect(200);
    expect(perms.body.length).toBeGreaterThan(15);
    const log = await get('/audit-log?entityType=User').expect(200);
    expect(log.body.some((x: { action: string }) => x.action === 'user.create')).toBe(true);
  });
});
