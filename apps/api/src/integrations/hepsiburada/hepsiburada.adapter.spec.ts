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

describe('Hepsiburada adaptörü (fetch sahte)', () => {
  const a = new HepsiburadaAdapter();
  const ctx = { accountId: 'x', credentials: { merchantId: 'M1', username: 'u', password: 'p' }, settings: {} as Record<string, unknown> };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  let spy: jest.SpyInstance;
  beforeEach(() => { spy = jest.spyOn(global, 'fetch'); });
  afterEach(() => { spy.mockRestore(); });

  it('createProducts: multipart gövdede merchantSku/Barcode/categoryId; batchRequestId mpop: ile başlar', async () => {
    spy.mockResolvedValue(json({ trackingId: 'T-1' }));
    const r = await a.createProducts(ctx, [{ externalId: '', sku: 'SKU1', barcode: '869000', title: 'Ürün', categoryExternalId: '123', price: 10, stock: 5, images: ['http://i/1.jpg'], channelAttributes: [{ attributeId: 'renk', valueId: 'kirmizi' }], raw: {} }]);
    expect(r[0]).toEqual({ ok: true, externalId: '869000', batchRequestId: 'mpop:T-1' });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://mpop.hepsiburada.com/product/api/products/import');
    const file = (init.body as FormData).get('file') as Blob; expect(file).toBeTruthy();
    const body = JSON.parse(await file.text());
    expect(body[0].categoryId).toBe(123); expect(body[0].merchant).toBe('M1');
    expect(body[0].attributes).toMatchObject({ merchantSku: 'SKU1', Barcode: '869000', UrunAdi: 'Ürün', GarantiSuresi: 24, price: 10, stock: 5, Image1: 'http://i/1.jpg', renk: 'kirmizi' });
  });
  it('createProducts: HTTP hatasında ok:false', async () => {
    spy.mockResolvedValue(new Response('bad', { status: 400 }));
    const r = await a.createProducts(ctx, [{ externalId: '', sku: 'S', title: 'T', raw: {} }]);
    expect(r[0].ok).toBe(false); expect(r[0].error).toContain('400');
  });
  it('checkBatch: mpop: öneki MPOP durum yolunu çağırır', async () => {
    spy.mockResolvedValue(json({ status: 'Done', items: [{ barcode: '869000', status: 'Success' }, { merchantSku: 'S2', status: 'Failed', errors: ['Marka bulunamadı'] }] }));
    const r = await a.checkBatch(ctx, 'mpop:T-1');
    expect(String(spy.mock.calls[0][0])).toContain('/product/api/products/status/T-1');
    expect(r.done).toBe(true);
    expect(r.items).toEqual([{ externalId: '869000', ok: true, errors: [] }, { externalId: 'S2', ok: false, errors: ['Marka bulunamadı'] }]);
  });
  it('updateShipment: invoiced fatura no yoksa ok:false ve istek atmaz', async () => {
    const r = await a.updateShipment(ctx, 'P1', { status: 'invoiced' });
    expect(r.ok).toBe(false); expect(r.error).toContain('invoiceNumber'); expect(spy).not.toHaveBeenCalled();
  });
  it('updateShipment: picking paketleme isteği', async () => {
    spy.mockResolvedValue(json({ packageNumber: 'P9' }));
    const r = await a.updateShipment(ctx, 'O1', { status: 'picking', lines: [{ externalId: 'L1', quantity: 2 }] });
    expect(r).toEqual({ ok: true, externalId: 'P9' });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://oms-external.hepsiburada.com/packages/merchantid/M1'); expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ lineItemRequests: [{ id: 'L1', quantity: 2 }] });
  });
  it('updateShipment: shipped, anlaşmalı kargoda istek atmadan ok', async () => {
    expect(await a.updateShipment(ctx, 'P1', { status: 'shipped' })).toEqual({ ok: true, externalId: 'P1' }); expect(spy).not.toHaveBeenCalled();
  });
  it('fetchShipmentLabel: base64 PDF döndürür', async () => {
    spy.mockResolvedValue(new Response(Buffer.from('%PDF-1.4 test'), { status: 200, headers: { 'Content-Type': 'application/pdf' } }));
    const r = await a.fetchShipmentLabel(ctx, 'P1');
    expect(String(spy.mock.calls[0][0])).toBe('https://oms-external.hepsiburada.com/packages/merchantid/M1/packagenumber/P1/labels?format=pdf');
    expect(r).toEqual({ contentType: 'application/pdf', base64: Buffer.from('%PDF-1.4 test').toString('base64'), fileName: 'hb-P1.pdf' });
  });
});
