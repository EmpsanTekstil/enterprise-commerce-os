/** Sistemdeki tüm yetki anahtarları ve varsayılan roller. Seed ve guard'lar bu listeyi kullanır. */
export const PERMISSIONS: Record<string, string> = {
  'dashboard.read': 'Genel bakışı görüntüle',
  'products.read': 'Ürünleri görüntüle',
  'products.write': 'Ürün oluştur / düzenle',
  'listings.read': 'Pazaryeri yayınlarını görüntüle',
  'listings.write': 'Pazaryeri yayınlarını yönet',
  'orders.read': 'Siparişleri görüntüle',
  'orders.write': 'Sipariş işlemleri (kargo, iptal, iade)',
  'inventory.read': 'Stok görüntüle',
  'inventory.write': 'Stok düzenle',
  'pricing.read': 'Fiyatları görüntüle',
  'pricing.write': 'Fiyat kuralları ve güncelleme',
  'ads.read': 'Reklam raporlarını görüntüle',
  'ads.write': 'Reklam kampanyalarını yönet',
  'support.read': 'Müşteri sorularını ve yorumları görüntüle',
  'support.write': 'Soru ve yorumlara cevap ver',
  'ai.use': 'Yapay zekâ stüdyosunu kullan',
  'finance.read': 'Finans ve raporları görüntüle',
  'automations.write': 'Otomasyonları yönet',
  'integrations.write': 'Entegrasyonları (kanal hesapları) yönet',
  'users.write': 'Kullanıcı ve rolleri yönet',
  'settings.write': 'Sistem ayarlarını değiştir',
};

export const DEFAULT_ROLES: { key: string; name: string; permissions: string[] }[] = [
  { key: 'admin', name: 'Yönetici', permissions: Object.keys(PERMISSIONS) },
  {
    key: 'product_manager',
    name: 'Ürün Yöneticisi',
    permissions: ['dashboard.read', 'products.read', 'products.write', 'listings.read', 'listings.write', 'inventory.read', 'inventory.write', 'pricing.read', 'ai.use'],
  },
  { key: 'order_staff', name: 'Sipariş Personeli', permissions: ['dashboard.read', 'orders.read', 'orders.write', 'inventory.read', 'products.read'] },
  { key: 'ads_manager', name: 'Reklam Yöneticisi', permissions: ['dashboard.read', 'ads.read', 'ads.write', 'products.read', 'ai.use'] },
  { key: 'support', name: 'Müşteri Destek Personeli', permissions: ['dashboard.read', 'support.read', 'support.write', 'products.read', 'orders.read', 'ai.use'] },
  { key: 'finance', name: 'Finans Kullanıcısı', permissions: ['dashboard.read', 'finance.read', 'orders.read', 'pricing.read', 'ads.read'] },
];
