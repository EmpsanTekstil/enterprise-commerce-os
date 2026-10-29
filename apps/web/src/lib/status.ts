export const ORDER_STATUS: Record<string, { l: string; t: 'ok' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  NEW: { l: 'Yeni', t: 'warn' }, CONFIRMED: { l: 'Onaylandı', t: 'info' }, PICKING: { l: 'Toplanıyor', t: 'info' }, PACKED: { l: 'Paketlendi', t: 'info' },
  SHIPPED: { l: 'Kargoda', t: 'info' }, DELIVERED: { l: 'Teslim edildi', t: 'ok' }, CANCELLED: { l: 'İptal', t: 'bad' }, RETURNED: { l: 'İade', t: 'bad' }, UNKNOWN: { l: 'Bilinmiyor', t: 'neutral' },
};
