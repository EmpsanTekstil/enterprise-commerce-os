# PRD — Enterprise Commerce OS

**Sürüm:** 0.1 (Faz 1) · **Tarih:** 29 Ekim 2026 · **Durum:** Onay bekliyor

## 1. Amaç

Türkiye'de birden fazla satış kanalında (pazaryerleri ve kendi mağaza platformları) satış yapan bir işletmenin ürün, stok, sipariş, kargo, reklam, müşteri iletişimi ve finans operasyonlarını **tek bir web uygulamasından**, gerçek API bağlantılarıyla yönetmesini sağlamak.

## 2. Kapsam

### 2.1 Kanallar
- **İlk uygulama sırası:** Trendyol → Hepsiburada → Amazon Türkiye → n11 → idefix → Shopify.
- **Hedef:** 10–20 kanal. Mimari kanal sayısından bağımsızdır; her kanal bir adaptör dosyasıdır.
- Aynı kanalda birden fazla mağaza hesabı desteklenir.
- Bir kanalın API'si bir işlemi desteklemiyorsa arayüz bunu açıkça "Desteklenmiyor" olarak gösterir; sahte işlem yoktur.

### 2.2 Kullanıcılar ve roller
| Rol | Ne yapar |
|---|---|
| Yönetici | Her şey; kullanıcı, entegrasyon ve ayar yönetimi |
| Ürün Yöneticisi | Katalog, varyant, görsel, yayın, stok |
| Sipariş Personeli | Sipariş, paketleme, kargo, iade |
| Reklam Yöneticisi | Kampanya ve reklam analitiği |
| Müşteri Destek | Sorular, yorumlar, cevaplar |
| Finans | Raporlar, kârlılık, giderler (salt okunur) |

### 2.3 Modüller ve öncelik
| # | Modül | Faz | Öncelik |
|---|---|---|---|
| 1 | Giriş, yetki, Genel Bakış | 2 | Zorunlu |
| 2 | Ürün yönetimi (PIM), varyant, görsel | 3 | Zorunlu |
| 3 | Trendyol entegrasyonu (ürün çekme, yayınlama, stok/fiyat) | 4 | Zorunlu |
| 4 | Diğer kanallar (adaptör başına ayrı teslim) | 5 | Yüksek |
| 5 | Stok/depo, sipariş, kargo, iade | 6 | Zorunlu |
| 6 | Fiyat ve kârlılık | 6 | Yüksek |
| 7 | Reklam (rapor; API izin verirse yönetim) | 7 | Yüksek |
| 8 | Müşteri soruları, yorumlar, birleşik gelen kutusu | 8 | Yüksek |
| 9 | Yapay zekâ stüdyosu, otomasyon, finans raporları | 9 | Orta |
| 10 | Güvenlik sertleştirme, performans, test, canlıya alma | 10 | Zorunlu |

## 3. Fonksiyonel gereksinimler (özet)

### 3.1 Genel Bakış
Bugünkü/haftalık/aylık ciro, sipariş sayıları (bekleyen, kargolanacak, iptal/iade), aktif ürün, stok uyarısı, reklam harcaması ve reklam satışı, tahmini net kâr, bekleyen soru, yeni yorum, API bağlantı durumları, senkronizasyon hataları. Tarih aralığı seçilebilir; kart yerleşimi kullanıcı bazında kaydedilir.

### 3.2 Ürün yönetimi
- Tek formdan ürün: ad, marka, model, kategori, açıklamalar, teknik özellikler, paket içeriği, garanti, menşei, KDV, varyantlar (SKU, barkod, renk, beden, ölçü, ağırlık, malzeme, maliyet, fiyat, stok), görseller.
- Kanal-özel başlık/açıklama/kategori/özellik/fiyat/görsel sıralaması (`Listing`).
- Kanal kategori ağacı ve zorunlu özellikler API'den çekilir; yayın öncesi eksikler listelenir.
- Toplu işlemler: Excel/CSV içe aktarma (önizleme + hata raporu), toplu fiyat/stok/açıklama/kategori/yayın.
- Mevcut kanal ürünlerini içe aktarma; barkod/SKU ile eşleştirme **önerisi** (otomatik birleştirme yok).

### 3.3 Stok
Merkezi havuz, çoklu depo, fiziksel/rezerve/satılabilir stok, hareket defteri, kritik stok uyarısı, kanal stok politikası (% pay, tampon), sipariş/iade sonrası otomatik güncelleme, mutabakat raporu, çift düşüm engeli.

### 3.4 Sipariş ve kargo
Tüm kanallar tek listede; filtre, arama, toplu işlem, Excel dışa aktarma; sipariş geçmişi; sipariş bazında kârlılık; paketleme akışı; takip numarası; geciken gönderi; iade kargoları.

### 3.5 Reklam
Kanal bazında kampanya, bütçe, harcama, gösterim, tıklama, CTR, CPC, ROAS, ACOS, ürün bazında performans. Yönetim işlemleri yalnızca API destekliyorsa. AI yalnızca öneri üretir; bütçe değişikliği onay gerektirir.

### 3.6 Müşteri soruları ve yorumlar
Birleşik gelen kutusu, durum takibi, personel atama, yanıt süresi, hazır şablonlar, AI taslak (yalnızca katalog verisine dayalı), onay sonrası gönderim; yorum sınıflandırma ve tekrarlayan sorun tespiti.

### 3.7 Fiyatlandırma ve finans
Maliyet + KDV + komisyon + kargo + paketleme + reklam + diğer → brüt/net kâr, hedef marj; kanal bazlı kurallar; güvenli alt/üst limit; otomatik güncelleme onaylı. Raporlar: satış, kanal karşılaştırma, ürün kârlılığı, iade oranı, stok devir hızı; Excel/CSV.

### 3.8 Otomasyon
Kural tabanlı tetikleyiciler (stok azaldı, sipariş geldi, soru geldi, olumsuz yorum, reklam limiti, API koptu, yayın hatası, sipariş gecikti) → bildirim/e-posta/işlem; açılıp kapatılabilir.

## 4. Fonksiyonel olmayan gereksinimler
- **Dil:** Arayüz tamamen Türkçe.
- **Erişim:** Masaüstü ve mobil uyumlu; açık/koyu tema.
- **Güvenlik:** Şifreli API anahtarları, rol bazlı yetki, audit log, rate limit, KVKK uyumu, yedekleme.
- **Güvenilirlik:** Her dış çağrı kuyruklu ve yeniden denemeli; başarısız işler görünür; idempotent işlemler.
- **Şeffaflık:** Demo verisi işaretli; bağlantı yoksa "bağlı" gösterilmez; başarısız işlem gizlenmez.
- **Performans hedefi (ilk sürüm):** 50.000 varyant, günde 5.000 sipariş, 20 kanal hesabı.

## 5. Varsayımlar (onay bekliyor)
1. Tek işletme; ileride çok kiracılı satış için organizasyon modeli hazır.
2. Barındırma: Docker ile tek VPS (başlangıç), ileride ayrılabilir.
3. Yapay zekâ: Claude API; model ve bütçe ayarlanabilir.
4. Kargo: Kanalların kendi kargo anlaşmaları; ayrı kargo API'si ilk sürümde yok.
5. e-Fatura/ERP entegrasyonu kapsam dışı (ileride Logo/Paraşüt adaptörü eklenebilir).

## 6. Başarı ölçütleri (Faz 4 sonu)
- Trendyol hesabı bağlanıp gerçek ürünler içe aktarılıyor.
- Panelden oluşturulan ürün Trendyol'da yayınlanıyor.
- Stok/fiyat değişikliği 5 dk içinde Trendyol'a yansıyor.
- Siparişler panelde görünüyor ve stok otomatik düşüyor (çift düşüm yok).

## 7. Riskler
| Risk | Etki | Önlem |
|---|---|---|
| Bazı kanallarda reklam / yorum / soru API'si yok | Modül o kanalda rapor-only kalır | Yetenek matrisi; arayüzde "Desteklenmiyor" |
| Amazon SP-API ve Ads API onay süreci uzun | Amazon fazı gecikir | Başvuruya erken başlanır |
| idefix API dokümantasyonu sınırlı | Adaptör gecikir | Satıcı destek ile doküman talebi |
| Kanal API değişiklikleri | Senkronizasyon bozulur | `rawSnapshot`, sürümlü adaptörler, hata bildirimleri |
