import { ChannelAdapter } from '../adapter.interface';
import { IdefixAdapter } from './idefix.adapter';

const ctx = (settings: Record<string, unknown> = {}) => ({ accountId: 'x', credentials: { apiKey: 'k', apiSecret: 's', vendorId: '77' }, settings });
const json = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response);

describe('idefix adaptörü (ağ gerektirmeyen, fetch sahte)', () => {
  const a = new IdefixAdapter();
  let spy: jest.SpyInstance;
  beforeEach(() => { spy = jest.spyOn(global, 'fetch'); });
  afterEach(() => spy.mockRestore());

  it('createProducts: gövde doğru, batchRequestId döner', async () => {
    spy.mockResolvedValue(json({ batchRequestId: 'b-1', status: 'created' }));
    const r = await a.createProducts(ctx({ cargoCompanyId: '5', shipmentAddressId: 9 }), [{ externalId: 'e1', sku: 'S1', barcode: '869000', title: 'Ürün', brandExternalId: '12', categoryExternalId: '340', price: 120, salePrice: 100, stock: 3, images: ['https://i/1.jpg'], channelAttributes: [{ attributeId: '1', valueId: '2' }, { attributeId: '3', customValue: 'Kırmızı' }], raw: null }]);
    expect(r[0]).toMatchObject({ ok: true, externalId: '869000', batchRequestId: 'pool:b-1' });
    const [url, init] = spy.mock.calls[0]; const body = JSON.parse((init as RequestInit).body as string);
    expect(url).toBe('https://merchantapi.idefix.com/pim/pool/77/create'); expect((init as RequestInit).method).toBe('POST');
    expect(body.products[0]).toMatchObject({ barcode: '869000', categoryId: 340, brandId: 12, cargoCompanyId: 5, shipmentAddressId: 9, productMainId: 'S1', vendorStockCode: 'S1', price: 100, comparePrice: 120, inventoryQuantity: 3, images: [{ url: 'https://i/1.jpg' }] });
    expect(body.products[0].attributes).toEqual([{ attributeId: 1, attributeValueId: 2 }, { attributeId: 3, customAttributeValue: 'Kırmızı' }]);
  });
  it('createProducts: cargoCompanyId yoksa göndermez', async () => {
    const r = await a.createProducts(ctx(), [{ externalId: 'e1', barcode: '1', title: 'x', brandExternalId: '1', categoryExternalId: '1', raw: null }]);
    expect(r[0].ok).toBe(false); expect(r[0].error).toContain('cargoCompanyId'); expect(spy).not.toHaveBeenCalled();
  });
  it('checkBatch: pool öneki batch-result uç noktasına gider', async () => {
    spy.mockResolvedValue(json({ status: 'completed', products: [{ barcode: '1', status: 'ready_for_sale' }, { barcode: '2', status: 'missing_info', failureReasons: ['brand'] }] }));
    const r = await a.checkBatch(ctx(), 'pool:b-1');
    expect(spy.mock.calls[0][0]).toBe('https://merchantapi.idefix.com/pim/pool/77/batch-result/b-1');
    expect(r.done).toBe(true); expect(r.items).toEqual([{ externalId: '1', ok: true, errors: [] }, { externalId: '2', ok: false, errors: ['brand'] }]);
  });
  it('updateShipment shipped: update-tracking-number, trackingNumber + trackingUrl', async () => {
    spy.mockResolvedValue(json({}));
    const r = await a.updateShipment(ctx({ trackingUrlTemplate: 'https://kargo.test/t?no={trackingNumber}' }), '555', { status: 'shipped', trackingNumber: 'TR123' });
    expect(r.ok).toBe(true);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://merchantapi.idefix.com/oms/77/555/update-tracking-number'); expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ trackingNumber: 'TR123', trackingUrl: 'https://kargo.test/t?no=TR123' });
  });
  it('updateShipment shipped: takip no yoksa ok:false', async () => {
    const r = await a.updateShipment(ctx({ trackingUrlTemplate: 'x' }), '555', { status: 'shipped' });
    expect(r.ok).toBe(false); expect(r.error).toContain('trackingNumber'); expect(spy).not.toHaveBeenCalled();
  });
  it('updateShipment invoiced: update-shipment-status, invoiceNumber', async () => {
    spy.mockResolvedValue(json({}));
    const r = await a.updateShipment(ctx(), '555', { status: 'invoiced', invoiceNumber: 'F-1' });
    expect(r.ok).toBe(true);
    expect(spy.mock.calls[0][0]).toBe('https://merchantapi.idefix.com/oms/77/555/update-shipment-status');
    expect(JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)).toEqual({ status: 'invoiced', invoiceNumber: 'F-1' });
  });
  it('etiket API yok: fetchShipmentLabel tanımsız', () => { expect((a as ChannelAdapter).fetchShipmentLabel).toBeUndefined(); expect(a.capabilities['shipping.update'].note).toContain('Etiket API yok'); });
});
