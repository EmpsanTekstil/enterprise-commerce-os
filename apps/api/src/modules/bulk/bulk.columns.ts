/** Toplu ürün yükleme şablonu: sütun anahtarı, başlık, zorunluluk, açıklama. Sıra şablonda korunur. */
export const PRODUCT_COLUMNS = [
  { key: 'urun_grubu', title: 'Ürün Grubu', required: false, hint: 'Aynı ürünün varyantlarını gruplar (boşsa ürün adı kullanılır)' },
  { key: 'urun_adi', title: 'Ürün Adı *', required: true, hint: 'En fazla 250 karakter' },
  { key: 'marka', title: 'Marka', required: false },
  { key: 'model', title: 'Model', required: false },
  { key: 'kategori', title: 'Kategori', required: false, hint: 'Yol olarak: Giyim > Tişört (yoksa oluşturulur)' },
  { key: 'sku', title: 'SKU *', required: true, hint: 'Varyant kodu, benzersiz' },
  { key: 'barkod', title: 'Barkod', required: false, hint: 'EAN/GTIN' },
  { key: 'renk', title: 'Renk', required: false },
  { key: 'beden', title: 'Beden', required: false },
  { key: 'olcu', title: 'Ölçü', required: false, hint: '30x20x10 cm' },
  { key: 'agirlik_gram', title: 'Ağırlık (g)', required: false, type: 'int' },
  { key: 'malzeme', title: 'Malzeme', required: false },
  { key: 'alis_maliyeti', title: 'Alış Maliyeti', required: false, type: 'money' },
  { key: 'satis_fiyati', title: 'Satış Fiyatı', required: false, type: 'money' },
  { key: 'stok', title: 'Stok', required: false, type: 'int', hint: 'Yalnızca yeni varyantlarda açılış stoğu olarak işlenir' },
  { key: 'kdv', title: 'KDV %', required: false, type: 'money' },
  { key: 'kisa_aciklama', title: 'Kısa Açıklama', required: false },
  { key: 'aciklama', title: 'Açıklama', required: false },
  { key: 'paket_icerigi', title: 'Paket İçeriği', required: false },
  { key: 'garanti_ay', title: 'Garanti (ay)', required: false, type: 'int' },
  { key: 'mensei', title: 'Menşei', required: false },
] as const;

export const PRICE_COLUMNS = [
  { key: 'sku', title: 'SKU *', required: true },
  { key: 'satis_fiyati', title: 'Satış Fiyatı', required: false, type: 'money' },
  { key: 'alis_maliyeti', title: 'Alış Maliyeti', required: false, type: 'money' },
] as const;

export const STOCK_COLUMNS = [
  { key: 'sku', title: 'SKU *', required: true },
  { key: 'stok', title: 'Yeni Stok *', required: true, type: 'int', hint: 'Depodaki fiziksel adet (mutlak değer)' },
  { key: 'depo_kodu', title: 'Depo Kodu', required: false, hint: 'Boşsa ana depo (MAIN)' },
] as const;

export type ColumnDef = { key: string; title: string; required: boolean; type?: 'int' | 'money'; hint?: string };
