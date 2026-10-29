import { N11Adapter } from './n11.adapter';
import { IdefixAdapter } from '../idefix/idefix.adapter';

describe('n11 / idefix adaptörleri (ağ gerektirmeyen)', () => {
  it('n11 durum eşlemesi', () => {
    const a = new N11Adapter();
    expect(a.mapOrderStatus('Created')).toBe('NEW'); expect(a.mapOrderStatus('Shipped')).toBe('SHIPPED'); expect(a.mapOrderStatus('UnSupplied')).toBe('CANCELLED'); expect(a.mapOrderStatus('Bilinmeyen')).toBe('UNKNOWN');
  });
  it('idefix durum eşlemesi', () => {
    const a = new IdefixAdapter();
    expect(a.mapOrderStatus('shipment_in_cargo')).toBe('SHIPPED'); expect(a.mapOrderStatus('shipment_invoiced')).toBe('PACKED'); expect(a.mapOrderStatus('shipment_unsupplied')).toBe('CANCELLED');
  });
  it('eksik kimlik bilgisinde açık hata verir', async () => {
    const n = await new N11Adapter().testConnection({ accountId: 'x', credentials: {}, settings: {} });
    expect(n.ok).toBe(false); expect(n.message).toContain('appKey');
    const i = await new IdefixAdapter().testConnection({ accountId: 'x', credentials: { apiKey: 'a' }, settings: {} });
    expect(i.ok).toBe(false); expect(i.message).toContain('vendorId');
  });
  it('n11 ürün yüklemede kargo şablonu yoksa göndermez', async () => {
    const r = await new N11Adapter().createProducts({ accountId: 'x', credentials: { appKey: 'a', appSecret: 'b' }, settings: {} }, [{ externalId: '1', title: 'x', raw: null }]);
    expect(r[0].ok).toBe(false); expect(r[0].error).toContain('shipmentTemplate');
  });
});
