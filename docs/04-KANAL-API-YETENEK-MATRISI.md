# Kanal API Yetenek Matrisi

**Doğrulama tarihi:** 29 Ekim 2026 · **Kaynak önceliği:** yalnızca resmî geliştirici portalları. İkincil kaynaklar açıkça işaretlenmiştir.

Durum anahtarı: ✅ resmî dokümanla doğrulandı · 🟡 var ama koşullu (onay/program/IP) · ❌ resmî API yok · ❔ doğrulanamadı (doküman erişilemedi)

> Kural: ❌ ve ❔ olan işlemler için uygulama "gerçek entegrasyon" göstermez; arayüzde "Desteklenmiyor / Doğrulanmadı" rozeti çıkar.

## 1. Trendyol — ✅ tam doğrulandı

**Portal:** https://developers.trendyol.com · **Üretim:** `https://apigw.trendyol.com/integration/` · **Test:** `https://stageapigw.trendyol.com` (test için IP yetkisi gerekir; üretimde gerekmez)
**Kimlik:** Basic Auth (`API Key:API Secret`) + zorunlu `User-Agent: {SatıcıID} - SelfIntegration`. Anahtarlar: Partner Paneli → Hesap Bilgilerim → Entegrasyon Bilgileri (yalnızca ana kullanıcı görür).
**Önemli:** Product V1 ve Order V1 servisleri **15 Ekim 2026**'da kapatıldı; adaptör V2 uç noktalarını kullanır.
**Limitler (14 Eylül 2026 itibarıyla):** servis grubu bazında, satıcı kademesine göre; ürün okuma 1000–2000 istek/dk, ürün yazma 200–600/dk, stok-fiyat yazma 350–2000/dk; fiyat güncelleme barkod başına 30/dk; kategori/marka listesi 50/dk.

| İşlem | Durum | Uç nokta / Doküman |
|---|---|---|
| Ürün okuma | ✅ | `GET …/product/sellers/{id}/products/approved` ve `/unapproved` — [Product V2](https://developers.trendyol.com/v2.0/docs/product-v2-api-endpoint) |
| Ürün oluşturma | ✅ | `POST …/product/sellers/{id}/v2/products` — [Product Create v2](https://developers.trendyol.com/v2.0/docs/product-create-v2) (asenkron, batchRequestId ile sonuç) |
| Ürün güncelleme | ✅ | `content-bulk-update`, `variant-bulk-update`, `delivery-info-bulk-update` |
| Stok güncelleme | ✅ | `POST …/inventory/sellers/{id}/products/price-and-inventory` |
| Fiyat güncelleme | ✅ | aynı uç nokta |
| Sipariş okuma | ✅ | `GET …/order/sellers/{id}/v2/orders` — [Order V2](https://developers.trendyol.com/v2.0/docs/get-order-packages-getshipmentpackages); en fazla 2 haftalık aralık, sayfa başına 200 |
| Kargo işlemleri | ✅ | paket durumu (updatePackage), kargo firması değiştirme, paket bölme, fatura linki gönderme |
| İade okuma | ✅ | getClaims — [İade akışı](https://developers.trendyol.com/docs/i%CC%87ade-s%C3%BCreci-ak%C4%B1%C5%9F%C4%B1) |
| İade onay/ret | ✅ | approveClaimLineItems, createClaimIssue |
| Soru okuma | ✅ | `GET …/qna/sellers/{id}/questions/filter` — [doküman](https://developers.trendyol.com/reference/getquestionfilter) |
| Soru cevaplama | ✅ | `POST …/qna/sellers/{id}/questions/{qid}/answers` — 10–2000 karakter, Trendyol incelemesi sonrası yayınlanır |
| Yorum okuma | ❌ | Satıcı API dokümanında yorum uç noktası yok |
| Yorum cevaplama | ❌ | Yalnızca satıcı panelinden |
| Reklam raporu / oluşturma / bütçe / durdurma | ❌ | Trendyol Reklam için açık satıcı API'si yok; reklam verileri panelden Excel ile alınıp içe aktarılabilir (Faz 7'de "manuel içe aktarma" yolu) |
| Kategori / özellik | ✅ | `product-categories`, `categories/{id}/attributes` (V2), özellik değerleri |
| Webhook | ✅ | Sipariş paketi olayları; satıcı başına 15 webhook; teslimat garantisi yok → periyodik senkron şart — [doküman](https://developers.trendyol.com/docs/webhook-model) |

## 2. Hepsiburada — ❔ portal bu ortamdan okunamadı

**Portal:** https://developers.hepsiburada.com (JavaScript tabanlı; bu oturumda içerik alınamadı). Bilinen API aileleri: **Listing API** (stok/fiyat/ilan), **OMS API** (sipariş/paket/kargo), **MPOP katalog** (ürün oluşturma), ayrı test (SIT) ortamı. Kimlik: Merchant ID + kullanıcı adı/şifre (Basic Auth). Satıcı panelinden API kullanıcısı oluşturulur ve entegrasyon başvurusu onaylanır (ikincil kaynak: [zunapro rehberi](https://www.zunapro.com/turkey/en/blog/hepsiburada-integration-api-guide-seller-manual)).

| İşlem | Durum | Not |
|---|---|---|
| Ürün okuma / oluşturma / güncelleme | ❔ (muhtemel ✅) | Listing + MPOP; PC'de portal açılarak doğrulanacak |
| Stok / fiyat | ❔ (muhtemel ✅) | Listing API |
| Sipariş okuma, kargo | ❔ (muhtemel ✅) | OMS API |
| İade | ❔ | |
| Soru / yorum / reklam | ❔ | Resmî kanıt bulunamadı |

**Yapılacak:** Yarın PC'de developers.hepsiburada.com açılıp Listing/OMS/MPOP bölümleri bu tabloya işlenecek (10 dk).

## 3. Amazon Türkiye — 🟡 doğrulanmış ama onay gerektirir (adaptör yazıldı: LWA, pazar doğrulama, sipariş, stok/fiyat patch, SKU bazlı ürün okuma; rapor akışı planlı)

**Portal:** https://developer-docs.amazon.com/sp-api · **Bölge:** EU (`sellingpartnerapi-eu.amazon.com`) · **Pazar ID (TR):** `A33AVAJ2PDY3EV` · **Kimlik:** Login with Amazon (OAuth 2.0, refresh token) — geliştirici profili kaydı ve rol onayı gerekir. Sandbox mevcut.

| İşlem | Durum | API |
|---|---|---|
| Ürün okuma | 🟡 | Listings Items API, Catalog Items API |
| Ürün oluşturma / güncelleme | 🟡 | Listings Items API (JSON_LISTINGS_FEED) + Product Type Definitions API (zorunlu özellikler) |
| Stok | 🟡 | Listings Items (FBM); FBA stoğu FBA Inventory API |
| Fiyat | 🟡 | Listings Items / Feeds |
| Sipariş okuma | 🟡 | Orders API; alıcı PII için **kısıtlı rol** (ayrı onay) |
| Kargo | 🟡 | Orders API (confirmShipment), Merchant Fulfillment API |
| İade | 🟡 | Rapor (GET_FLAT_FILE_RETURNS…) |
| Müşteri soruları | ❌ | Alıcı Q&A API'si yok; Messaging API yalnızca şablonlu alıcı mesajları |
| Yorum okuma / cevaplama | ❌ | API yok |
| Reklam raporu / oluşturma / bütçe / durdurma | 🟡 | **Amazon Ads API** (ayrı başvuru ve onay) — Sponsored Products v3 |
| Kategori / özellik | 🟡 | Product Type Definitions API |
| Bildirim | 🟡 | Notifications API (SQS/EventBridge) |

Not: Amazon bilgileri resmî dokümandan bilinen, kararlı özelliklerdir; adaptör yazılırken tekrar doğrulanacak.

## 4. n11 — ✅ büyük ölçüde doğrulandı (adaptör yazıldı: ürün/kategori/stok-fiyat/ürün yükleme/sipariş/soru-cevap)

**Portal:** https://developer.n11.com · **Üretim:** `https://api.n11.com` (REST/JSON; eski SOAP API yerini aldı) · **Kimlik:** `appKey` ve `appSecret` başlıkları. Anahtarlar: n11 Mağaza Paneli → API hesapları.

| İşlem | Durum | Uç nokta / Doküman |
|---|---|---|
| Ürün okuma | ✅ | Satıcı Ürün Sorgulama |
| Ürün oluşturma | ✅ | Ürün Yükleme (asenkron, Task Detail ile sonuç) |
| Ürün güncelleme | ✅ | Ürün Bilgisi Güncelleme |
| Stok / fiyat | ✅ | Ürün Fiyat-Stok Güncelleme |
| Sipariş okuma | ✅ | `GET https://api.n11.com/rest/delivery/v1/shipmentPackages` — sayfa 100, 1000 istek/dk |
| Kargo işlemleri | ✅ | Sipariş kalemi güncelleme, paket bölme, toplama talebi, fatura linki |
| İade | ✅ | İade Talepleri Servisi, parçalı iptal |
| Soru okuma / cevaplama | ✅ | Ürün Soru-Cevap Servisi (ayrıntı adaptör yazılırken) |
| Yorum okuma / cevaplama | ❌ | Dokümanda yok |
| Reklam | ❌ | Dokümanda yok |
| Kategori / özellik | ✅ | `GET /cdn/categories`, Kategori Özellikleri Listeleme |
| Webhook | ❌ | Dokümanda yok |

## 5. idefix — ✅ doğrulandı (adaptör yazıldı: ürün okuma/stok-fiyat/sipariş; ürün oluşturma ve iade planlandı)

**Portal:** https://developer.idefix.com · **Üretim:** `https://merchantapi.idefix.com` (PIM ve OMS) · **Test:** `ide-pimapi.idefiks.net`, `ide-omsapi.idefiks.net` (test için IP yetkisi gerekir) · **Kimlik:** `X-API-KEY: base64(ApiKey:ApiSecret)`. Anahtarlar: Satıcı Paneli → Hesap Bilgilerim → Entegrasyon Bilgileri → "Yeni API Oluştur" (e-postaya gelir). 429'da `Retry-After` başlığı.

| İşlem | Durum | Doküman |
|---|---|---|
| Ürün okuma | ✅ | Ürünlerim Listesi |
| Ürün oluşturma | ✅ | Ürün Oluşturma, Hızlı Ürün Ekleme (durum sorgulama ile) |
| Ürün güncelleme | ✅ | Ürün Oluşturma (güncelleme dahil), merchant onay/ret |
| Stok / fiyat | ✅ | inventory-upload + inventory-result |
| Sipariş okuma | ✅ | Siparişlerin Alınması |
| Kargo işlemleri | ✅ | Sipariş statü güncelleme, kargo kodları, paket bölme, fatura linki |
| İade | ✅ | İade listesi, oluşturma, onaylama |
| Soru okuma / cevaplama | ✅ | Ürün Soruları + Sipariş Soruları entegrasyonu |
| Yorum | ❌ | Dokümanda yok |
| Reklam | ❌ | Dokümanda yok |
| Kategori / özellik | ✅ | Kategoriler, kategori özellik listesi, markalar |
| Webhook | ❌ | Dokümanda yok |

## 6. Shopify — ✅ (adaptör yazıldı: GraphQL 2026-01; ürün/varyant okuma, inventorySetQuantities, productVariantsBulkUpdate, sipariş)

**Portal:** https://shopify.dev · **Kimlik:** Custom app Admin API access token · GraphQL Admin API. Ürün/varyant/stok/fiyat/sipariş/kargo/iade tam destek; webhook var; "müşteri sorusu" ve "pazaryeri reklamı" kavramı yok (❌, kanal türü STOREFRONT). Adaptör yazılırken sürüm doğrulanacak.

## 7. Özet: hangi modül nerede gerçek çalışır

| Modül | Trendyol | Hepsiburada | Amazon TR | n11 | idefix | Shopify |
|---|---|---|---|---|---|---|
| Ürün / stok / fiyat | ✅ | ❔ | 🟡 | ✅ | ✅ | ✅ |
| Sipariş / kargo / iade | ✅ | ❔ | 🟡 | ✅ | ✅ | ✅ |
| Müşteri soruları | ✅ | ❔ | ❌ | ✅ | ✅ | — |
| Yorumlar | ❌ | ❔ | ❌ | ❌ | ❌ | — |
| Reklam | ❌ | ❔ | 🟡 (Ads API) | ❌ | ❌ | — |

**Sonuç:** Yorum modülü ve reklam modülü, Amazon Ads dışında API ile beslenemez. Bu modüller için plan: (a) Amazon Ads API ile gerçek entegrasyon, (b) diğer kanallarda satıcı panelinden indirilen Excel/CSV raporlarını içe aktarma, (c) yapay zekâ analizi bu içe aktarılan veriler üzerinde çalışır. Sahte "canlı bağlantı" gösterilmez.
