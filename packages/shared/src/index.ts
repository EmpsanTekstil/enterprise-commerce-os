/** API ile web arasında paylaşılan sabitler. */
export const ORDER_STATUS_TR: Record<string, string> = {
  NEW: 'Yeni', CONFIRMED: 'Onaylandı', PICKING: 'Toplanıyor', PACKED: 'Paketlendi', SHIPPED: 'Kargoda',
  DELIVERED: 'Teslim edildi', CANCELLED: 'İptal', RETURNED: 'İade', UNKNOWN: 'Bilinmiyor',
};
export const LISTING_STATUS_TR: Record<string, string> = {
  DRAFT: 'Taslak', PENDING: 'Onay bekliyor', ACTIVE: 'Yayında', REJECTED: 'Reddedildi', PAUSED: 'Durduruldu', ERROR: 'Hata', UNLINKED: 'Eşleşmedi',
};
