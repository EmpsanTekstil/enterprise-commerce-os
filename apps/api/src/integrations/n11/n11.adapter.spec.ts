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
  describe('n11 updateShipment (fetch sahte)', () => {
    const ctx = { accountId: 'x', credentials: { appKey: 'a', appSecret: 'b' }, settings: { shipmentCompany: 'Yurtiçi' } };
    let spy: jest.SpyInstance;
    beforeEach(() => { spy = jest.spyOn(global, 'fetch'); });
    afterEach(() => spy.mockRestore());
    it('shipped: takip no yoksa ok:false', async () => {
      const r = await new N11Adapter().updateShipment(ctx, '9', { status: 'shipped', lines: [{ externalId: '1', quantity: 1 }] });
      expect(r.ok).toBe(false); expect(r.error).toContain('trackingNumber'); expect(spy).not.toHaveBeenCalled();
    });
    it('picking: PUT /rest/order/v1/update ile Picking gönderir', async () => {
      spy.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ content: [{ lineId: 1, status: 'SUCCESS' }] }) } as unknown as Response);
      const r = await new N11Adapter().updateShipment(ctx, '9', { status: 'picking', lines: [{ externalId: '1', quantity: 1 }] });
      expect(r.ok).toBe(true);
      const [url, init] = spy.mock.calls[0];
      expect(url).toBe('https://api.n11.com/rest/order/v1/update'); expect((init as RequestInit).method).toBe('PUT'); expect((init as RequestInit).headers).toMatchObject({ appKey: 'a', appSecret: 'b' });
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ lines: [{ lineId: 1 }], status: 'Picking' });
    });
    it('shipped: kalem başına trackingNumber + shipmentCompany', async () => {
      spy.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ content: [{ lineId: 1, status: 'SUCCESS' }] }) } as unknown as Response);
      const r = await new N11Adapter().updateShipment(ctx, '9', { status: 'shipped', trackingNumber: 'T1', lines: [{ externalId: '1', quantity: 1 }] });
      expect(r.ok).toBe(true);
      expect(JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)).toEqual({ lines: [{ lineId: 1, trackingNumber: 'T1', shipmentCompany: 'Yurtiçi' }], status: 'Shipped' });
    });
    it('invoiced: n11 karşılığı yok, ok:true, istek yok', async () => {
      const r = await new N11Adapter().updateShipment(ctx, '9', { status: 'invoiced' });
      expect(r.ok).toBe(true); expect(spy).not.toHaveBeenCalled();
    });
  });
});
