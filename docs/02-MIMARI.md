# Sistem Mimarisi — Enterprise Commerce OS

## 1. Temel karar: modüler monolit + kanal adaptörleri

Tek bir NestJS uygulaması içinde, iş alanlarına göre bölünmüş modüller. Mikroservis yok: tek veritabanı, tek dağıtım, tek log akışı. Ölçek gerektiğinde yalnızca **arka plan işçileri** (BullMQ worker) ayrı süreç olarak çoğaltılır.

```
┌───────────────────────────────┐        ┌──────────────────────────────────────┐
│  apps/web  (Next.js, Türkçe)  │  HTTPS │  apps/api  (NestJS, REST + OpenAPI)   │
│  Giriş · Genel Bakış · Ürün   │ ─────▶ │  ┌──────────┐ ┌─────────┐ ┌────────┐ │
│  Siparişler · Reklam · AI …   │        │  │ auth     │ │products │ │orders  │ │
└───────────────────────────────┘        │  │ channels │ │inventory│ │ads     │ │
                                          │  │ support  │ │ai       │ │finance │ │
                                          │  └──────────┘ └─────────┘ └────────┘ │
                                          │  ┌──────────────────────────────────┐ │
                                          │  │ integrations/ (Adaptör Kayıt)    │ │
                                          │  │ trendyol · hepsiburada · amazon  │ │
                                          │  │ n11 · idefix · shopify · …       │ │
                                          │  └──────────────────────────────────┘ │
                                          └───────┬───────────┬──────────┬────────┘
                                                  │           │          │
                                     ┌────────────▼──┐  ┌─────▼────┐ ┌───▼──────────┐
                                     │ PostgreSQL 16 │  │ Redis +  │ │ S3 / MinIO   │
                                     │ (Prisma)      │  │ BullMQ   │ │ (görseller)  │
                                     └───────────────┘  └──────────┘ └──────────────┘
                                                              │
                                                    ┌─────────▼──────────┐
                                                    │ Worker süreçleri    │
                                                    │ sipariş çekme, stok │
                                                    │ gönderme, reklam    │
                                                    │ raporu, AI işleri   │
                                                    └────────────────────┘
```

## 2. Kanal adaptörü sözleşmesi

`apps/api/src/integrations/adapter.interface.ts` dosyasındaki `ChannelAdapter` arayüzü her kanal için tek giriş noktasıdır.

- Adaptör **yeteneklerini bildirir** (`capabilities`): `supported / planned / conditional / unsupported / unverified`. Arayüz, desteklenmeyen işlemlerin butonlarını bu bilgiye göre gizler.
- Desteklenmeyen bir işlem çağrılırsa `UnsupportedOperationError` fırlatılır; sahte başarı döndürülmez.
- Adaptör **normalize edilmiş** tiplerle konuşur (`ExternalOrder`, `ExternalProduct`…). Kanal-özel ham veri `raw` alanında ve veritabanında `rawSnapshot` sütununda saklanır; böylece ileride alan eşleştirmesi düzeltilebilir.
- Yeni kanal eklemek: `integrations/<kanal>/<kanal>.adapter.ts` yaz → `AdapterRegistry` listesine ekle → `SalesChannel` seed'ine `code` ekle → arayüzde kimlik alanlarını `CREDENTIAL_FIELDS`'a ekle. Başka hiçbir modül değişmez.

## 3. Senkronizasyon ve idempotentlik

- Tüm dış çağrılar BullMQ kuyruklarına iş olarak yazılır (`ListingSyncJob` tablosu + Redis). Her işin `idempotencyKey`'i vardır; aynı iş iki kez kuyruğa girse bile bir kez çalışır.
- Siparişler `(channelAccountId, externalId)` benzersiz kısıtıyla saklanır → aynı sipariş ikinci kez çekilirse güncellenir, kopyalanmaz.
- Stok hareketleri `InventoryMovement` tablosunda `(referenceKey, type)` benzersizdir → aynı sipariş için ikinci kez `SALE_OUT` yazılamaz; çift düşüm veritabanı seviyesinde engellenir.
- Stok mutabakatı: periyodik iş, her kanal hesabındaki ilan stoğunu (`Listing.stockQuantity`) merkezi satılabilir stokla karşılaştırır, farkları `Notification` olarak raporlar.

## 4. Güvenlik

| Konu | Uygulama |
|---|---|
| Giriş | E-posta + bcrypt şifre, JWT (12 sa.), `helmet`, rate limit 300 istek/dk |
| Yetki | Rol → yetki anahtarı (`products.write` vb.). `@RequirePermissions()` dekoratörü + `PermissionsGuard` |
| Kanal anahtarları | Veritabanında AES-256-GCM ile şifreli (`credentialsEnc`); anahtar yalnızca `CREDENTIALS_ENCRYPTION_KEY` ortam değişkeninde. API yanıtlarında maskelenmiş (`ab1****yz`) |
| Denetim | Önemli işlemler `AuditLog` (kim, ne, önce/sonra) |
| Çok kiracılılık | Her sorgu `organizationId` ile filtrelenir; JWT içinden gelir, istemciden alınmaz |
| KVKK | Müşteri verisi yalnızca sipariş işlemek için saklanır; e-posta/telefon maskeleme ve saklama süresi ayarı Faz 10'da |
| Dosya yükleme | Yalnızca görsel MIME türleri, boyut sınırı, S3'e sunucu tarafından imzalı yükleme |

## 5. Yapay zekâ ilkeleri

- Model yalnızca **katalogdaki doğrulanmış alanları** girdi olarak alır (specsJson, açıklama, varyant). Bilgi yoksa "bilgi yok" döner; uydurmaz.
- Her çağrı `AIRequest` tablosuna token ve maliyetle yazılır.
- Hiçbir AI çıktısı onay olmadan kanala gönderilmez (`QuestionResponse.isApproved`, `ReviewResponse.isApproved`).
- Reklam bütçesi ve fiyat değişiklikleri: AI yalnızca **öneri** üretir; uygulama kullanıcı onayı ve güvenli limit (`PricingRule.minPrice/maxPrice`) ile yapılır.

## 6. Ortamlar

| Ortam | Nasıl |
|---|---|
| Geliştirme | `docker compose up postgres redis minio` + `npm run dev:api` + `npm run dev:web` |
| Üretim (tek sunucu) | `docker compose --profile app up -d` (api + web + altyapı aynı makinede) |
| CI | GitHub Actions: Postgres servisi, migrate, typecheck, test, build |

## 7. Klasör yapısı

```
enterprise-commerce-os/
├── apps/
│   ├── api/                 NestJS backend
│   │   ├── prisma/          schema.prisma, migrations/, seed.ts
│   │   └── src/
│   │       ├── common/      crypto, pagination
│   │       ├── integrations/ adapter.interface, adapter.registry, <kanal>/
│   │       ├── modules/     auth, channels, products, dashboard, audit, health, …
│   │       └── prisma/      PrismaService
│   └── web/                 Next.js (App Router), Türkçe arayüz
│       └── src/app/(panel)/ sayfalar: /, /urunler, /entegrasyonlar, …
├── packages/shared/         ortak sabitler ve tipler
├── docs/                    PRD, mimari, ER, API yetenek matrisi
├── infra/                   Dockerfile'lar
├── docker-compose.yml
└── .github/workflows/ci.yml
```
