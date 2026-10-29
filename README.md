# Enterprise Commerce OS

Türkiye pazaryerleri (Trendyol, Hepsiburada, Amazon TR, n11, idefix…) ve kendi mağaza platformları (Shopify…) için **çok kanallı e-ticaret yönetim platformu**. Arayüz tamamen Türkçe.

Belgeler: [PRD](docs/01-PRD.md) · [Mimari](docs/02-MIMARI.md) · [ER Diyagramı](docs/03-ER-DIYAGRAMI.md) · [Kanal API Yetenek Matrisi](docs/04-KANAL-API-YETENEK-MATRISI.md)

---

## Kurulum (ilk kez, adım adım)

Gerekenler: **Node.js 22+** (https://nodejs.org), **Docker Desktop** (https://www.docker.com/products/docker-desktop/), **Git**.

### 1. Projeyi indir ve ortam dosyasını oluştur
```bash
git clone https://github.com/EmpsanTekstil/enterprise-commerce-os.git
cd enterprise-commerce-os
cp .env.example .env
```
`.env` dosyasını bir metin düzenleyiciyle aç ve iki satırı rastgele değerlerle değiştir:
```bash
# Terminalde üret (macOS/Linux/Git Bash):
openssl rand -hex 32   # → JWT_SECRET için
openssl rand -hex 32   # → CREDENTIALS_ENCRYPTION_KEY için (tam 64 karakter olmalı)
```
Windows PowerShell'de: `-join ((48..57)+(97..102) | Get-Random -Count 64 | % {[char]$_})`

### 2. Altyapıyı başlat (PostgreSQL, Redis, MinIO)
```bash
docker compose up -d postgres redis minio
```

### 3. Paketleri yükle, veritabanını oluştur, ilk kullanıcıyı ekle
```bash
npm install
npm run prisma:generate -w @eco/api
npm run prisma:deploy -w @eco/api
ADMIN_EMAIL=sen@ornek.com ADMIN_PASSWORD=GucluBirSifre123 ORG_NAME="Mağazam" npm run db:seed
```
Windows PowerShell'de ortam değişkenlerini şöyle ver:
```powershell
$env:ADMIN_EMAIL="sen@ornek.com"; $env:ADMIN_PASSWORD="GucluBirSifre123"; $env:ORG_NAME="Mağazam"; npm run db:seed
```
Demo ürün de istersen `SEED_DEMO=1` ekle (demo veriler "DEMO" etiketiyle ayrılır).

### 4. Uygulamayı çalıştır (iki terminal)
```bash
npm run dev:api     # http://localhost:4000  (API dokümantasyonu: http://localhost:4000/api/docs)
npm run dev:web     # http://localhost:3000
```
Tarayıcıda http://localhost:3000 → seed'de verdiğin e-posta ve şifreyle gir.

### 5. Trendyol hesabını bağla
Panelde **Entegrasyonlar → Trendyol → Hesap ekle**: Satıcı ID, API Key, API Secret gir → **Bağlantıyı test et**. Anahtarlar veritabanında şifreli saklanır.

---

## Komutlar
| Komut | Ne yapar |
|---|---|
| `npm run dev:api` / `npm run dev:web` | Geliştirme sunucuları |
| `npm run db:migrate` | Şema değişikliklerini veritabanına uygular |
| `npm run db:seed` | Yetkiler, roller, kanal kataloğu, yönetici |
| `npm run db:studio` | Veritabanı görsel editörü (Prisma Studio) |
| `npm test -w @eco/api` | Birim testleri |
| `npm run typecheck` | Tip kontrolü |
| `docker compose --profile app up -d --build` | Üretim: api + web + altyapı tek komutla |

## Sorun giderme
- **`CREDENTIALS_ENCRYPTION_KEY 64 karakterlik hex olmalı`** → `.env` içindeki değer tam 64 karakter 0-9a-f olmalı.
- **`ECONNREFUSED 5432`** → Docker çalışmıyor; `docker compose ps` ile kontrol et.
- **Giriş yapamıyorum** → Seed çıktısındaki e-postayı kullan; şifre `ADMIN_PASSWORD` ile verdiğin değer.
- Hata metnini olduğu gibi kopyalayıp Claude'a yapıştır.

## Proje yapısı
```
apps/api   NestJS backend (Prisma, BullMQ, kanal adaptörleri)
apps/web   Next.js arayüz (Türkçe, açık/koyu tema)
packages/  paylaşılan tipler
docs/      PRD, mimari, ER, yetenek matrisi
infra/     Dockerfile'lar
```

## Geliştirme durumu
- [x] Faz 1 — Gereksinim, mimari, veritabanı şeması, yetenek matrisi
- [x] CI (GitHub Actions): kurulum, migration, seed, tip kontrolü, birim + uçtan uca testler, derleme — her push'ta otomatik
- [x] Faz 2 (kısmi) — Giriş, rol/yetki, Genel Bakış (gerçek verilerle)
- [x] Faz 3 (kısmi) — Ürün listesi, ürün oluşturma, varyantlar, yayın hazırlık kontrolü
- [x] Entegrasyonlar ekranı — hesap ekleme, şifreli saklama, bağlantı testi
- [x] Faz 4 (çekirdek) — Senkron motoru (BullMQ veya inline), kanal ürünlerini içe aktarma + barkod/SKU eşleştirme önerileri, sipariş senkronu + çift düşümsüz stok, iptal/iadede stok iadesi, stok/fiyat gönderme, Yayınlar ve Siparişler ekranları, CSV dışa aktarma
- [x] Faz 3 devam — görsel yükleme (sürükle-bırak, sıralama, otomatik küçültme, S3/yerel), kategori ağacı, kanal kategori eşleştirme
- [x] Faz 3 son — Excel/CSV ile toplu ürün yükleme, toplu fiyat/stok (şablon, önizleme, satır bazlı hata raporu)
- [x] Faz 4 devam — Kanala ürün yayınlama: hazırlık kontrolü (barkod, görsel, marka, kategori eşleştirme, zorunlu özellikler), Trendyol Product Create v2, kanal onay sonucu takibi (ACTIVE/REJECTED), kanal-özel başlık/fiyat
- [ ] Faz 6 — Kargo takip güncelleme, iade onay/ret, Trendyol webhook alıcısı
