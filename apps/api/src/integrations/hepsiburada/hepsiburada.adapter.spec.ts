import { HepsiburadaAdapter } from './hepsiburada.adapter';

describe('Hepsiburada adaptörü (ağ gerektirmeyen)', () => {
  const a = new HepsiburadaAdapter();
  it('durum eşlemesi', () => { expect(a.mapOrderStatus('Unpacked')).toBe('NEW'); expect(a.mapOrderStatus('InTransit')).toBe('SHIPPED'); expect(a.mapOrderStatus('CancelledByCustomer')).toBe('CANCELLED'); });
  it('eksik kimlikte açık hata', async () => { expect((await a.testConnection({ accountId: 'x', credentials: { merchantId: 'm' }, settings: {} })).message).toContain('username'); });
  it('stok/fiyat: SKU çifti yoksa göndermez', async () => {
    const r = await a.updateStockAndPrice({ accountId: 'x', credentials: { merchantId: 'm', username: 'u', password: 'p' }, settings: {} }, [{ sku: 'S1', stock: 3 }]);
    expect(r[0].ok).toBe(false); expect(r[0].error).toContain('hepsiburadaSku');
  });
});
