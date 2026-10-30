import { AmazonAdapter } from '../amazon/amazon.adapter';
import { ShopifyAdapter } from './shopify.adapter';

describe('Shopify / Amazon adaptörleri (ağ gerektirmeyen)', () => {
  it('Shopify durum eşlemesi', () => { const a = new ShopifyAdapter(); expect(a.mapOrderStatus('UNFULFILLED')).toBe('NEW'); expect(a.mapOrderStatus('FULFILLED')).toBe('SHIPPED'); expect(a.mapOrderStatus('REFUNDED')).toBe('RETURNED'); });
  it('Amazon durum eşlemesi', () => { const a = new AmazonAdapter(); expect(a.mapOrderStatus('Unshipped')).toBe('NEW'); expect(a.mapOrderStatus('Shipped')).toBe('SHIPPED'); expect(a.mapOrderStatus('Canceled')).toBe('CANCELLED'); });
  it('eksik kimlikte açık hata', async () => {
    expect((await new ShopifyAdapter().testConnection({ accountId: 'x', credentials: {}, settings: {} })).message).toContain('shopDomain');
    expect((await new AmazonAdapter().testConnection({ accountId: 'x', credentials: { clientId: 'a' }, settings: {} })).message).toContain('refreshToken');
  });
  it('Shopify stok/fiyat: gid olmayan kimlikleri reddeder', async () => {
    const r = await new ShopifyAdapter().updateStockAndPrice({ accountId: 'x', credentials: { shopDomain: 'a.myshopify.com', accessToken: 't' }, settings: {} }, [{ externalId: '123', stock: 1 }]);
    expect(r[0].ok).toBe(false); expect(r[0].error).toContain('gid');
  });
});
