import { expect, test } from '@playwright/test';

const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.ADMIN_PASSWORD ?? 'Admin123!';
const t = Date.now();

async function login(page: import('@playwright/test').Page) {
  await page.goto('/giris');
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Şifre').fill(password);
  await page.getByRole('button', { name: 'Giriş Yap' }).click();
  await expect(page).toHaveURL('/');
}

test('giriş ve Genel Bakış kartları', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Bugünkü satış')).toBeVisible();
  await expect(page.getByText('API bağlantı durumları')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Genel Bakış' })).toBeVisible();
});

test('yanlış şifre Türkçe hata verir', async ({ page }) => {
  await page.goto('/giris');
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Şifre').fill('yanlis-sifre');
  await page.getByRole('button', { name: 'Giriş Yap' }).click();
  await expect(page.getByText('E-posta veya şifre hatalı')).toBeVisible();
});

test('ürün oluştur → detay → hazırlık eksikleri → kategori ata', async ({ page }) => {
  await login(page);
  await page.goto('/urunler/yeni');
  await page.getByLabel('Ürün adı *').fill(`UI Test Ürünü ${t}`);
  await page.getByLabel('Marka').fill('UIMarka');
  await page.getByLabel('SKU *').fill(`UI-${t}`);
  await page.getByLabel('Satış fiyatı (₺)').fill('149.90');
  await page.getByLabel('Açılış stoğu').fill('3');
  await page.getByRole('button', { name: 'Ürünü Kaydet' }).click();
  await expect(page).toHaveURL(/\/urunler\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: `UI Test Ürünü ${t}` })).toBeVisible();
  await expect(page.getByText('Yayın öncesi eksikler')).toBeVisible();
  await expect(page.getByText('Kategori', { exact: true }).first()).toBeVisible();
  // Kategori seçici ile yeni kategori ekle
  await page.getByRole('button', { name: 'Yeni' }).click();
  await page.getByPlaceholder('Kategori adı').fill(`UI Kategori ${t}`);
  await page.getByRole('button', { name: 'Ekle' }).click();
  await expect(page.locator('select').filter({ hasText: `UI Kategori ${t}` }).first()).toBeVisible();
});

test('ürün listesinde arama ve toplu işlemler şablonu', async ({ page }) => {
  await login(page);
  await page.goto('/urunler');
  await page.getByPlaceholder('Ürün adı, marka, SKU veya barkod ara').fill(`UI-${t}`);
  await expect(page.getByText(`UI Test Ürünü ${t}`)).toBeVisible();
  await page.goto('/toplu-islemler');
  await expect(page.getByText('Excel şablonunu indir')).toBeVisible();
});

test('entegrasyonlar: test kanalı ekle, bağlantıyı test et, yetenekleri gör', async ({ page }) => {
  await login(page);
  await page.goto('/entegrasyonlar');
  const card = page.locator('.card', { hasText: 'Test Kanalı' }).first();
  await card.getByRole('button', { name: 'Yetenekler' }).click();
  await expect(card.getByText('Ürün okuma')).toBeVisible();
  await card.getByRole('button', { name: 'Hesap ekle' }).click();
  await page.getByLabel('Hesap etiketi').fill(`UI Mağaza ${t}`);
  await page.getByLabel('API Key (test için: test)').fill('test');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  const acc = page.locator('.card', { hasText: `UI Mağaza ${t}` }).first();
  await expect(acc).toBeVisible();
  await acc.getByRole('button', { name: 'Bağlantıyı test et' }).click();
  await expect(acc.getByText('Test kanalı bağlı')).toBeVisible();
  await expect(acc.getByText('Bağlı', { exact: true })).toBeVisible();
});

test('menünün tamamı "yakında" olmadan açılır', async ({ page }) => {
  await login(page);
  await expect(page.getByText('yakında')).toHaveCount(0);
  for (const path of ['/yayinlar', '/siparisler', '/stok', '/kargo', '/fiyat', '/reklam', '/sorular', '/yorumlar', '/gelen-kutusu', '/yapay-zeka', '/finans', '/otomasyonlar', '/kullanicilar', '/ayarlar']) {
    await page.goto(path);
    await expect(page.getByText('Bu modül henüz geliştirilmedi')).toHaveCount(0);
    await expect(page.locator('main')).not.toBeEmpty();
  }
});

test('sorular ekranı sayaçları ve yorumlar uyarısı', async ({ page }) => {
  await login(page);
  await page.goto('/sorular');
  await expect(page.getByText('Cevap bekleyen')).toBeVisible();
  await page.goto('/yorumlar');
  await expect(page.getByText(/yorum okuma\/cevaplama sunmuyor/)).toBeVisible();
});
