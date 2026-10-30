import { TrendyolAdapter } from './trendyol.adapter';

describe('Trendyol adaptörü (ağ gerektirmeyen)', () => {
  it('Product V2 içeriğini varyant başına ürüne çevirir (gerçek yanıt biçimi)', () => {
    const content = {
      contentId: 1223826895, productMainId: 'NTBDFYNE023', brand: { id: 2826877, name: 'DFYNE' }, category: { id: 525, name: 'Eşofman Altı' },
      title: 'Tall Kadın Bol Paça Oversize Eşofman Altı', description: '<p>Açıklama</p>', images: [{ url: 'https://cdn/1.jpg' }],
      attributes: [{ attributeId: 47, attributeName: 'Renk', attributeValue: 'Kahverengi' }],
      variants: [
        { variantId: 1, barcode: 'NTBDFYNE0578', stockCode: '', onSale: true, archived: false, commission: 21.5, vatRate: 10, origin: 'TR', attributes: [{ attributeId: 338, attributeName: 'Beden', attributeValue: 'XL' }], stock: { quantity: 30 }, price: { salePrice: 1399, listPrice: 1499 } },
        { variantId: 2, barcode: 'NTBDFYNE0579', stockCode: 'SKU-L', onSale: false, archived: false, attributes: [{ attributeName: 'Beden', attributeValue: 'L' }], stock: { quantity: 0 }, price: { salePrice: 1399, listPrice: 1399 } },
        { variantId: 3, barcode: '', onSale: true },
      ],
    };
    const items = TrendyolAdapter.mapContent(content);
    expect(items).toHaveLength(2); // barkodsuz varyant atlanır
    expect(items[0]).toMatchObject({ externalId: 'NTBDFYNE0578', barcode: 'NTBDFYNE0578', sku: undefined, title: content.title, brand: 'DFYNE', brandExternalId: '2826877', groupId: 'NTBDFYNE023', categoryExternalId: '525', vatRate: 10, originCountryCode: 'TR', price: 1499, salePrice: 1399, stock: 30, images: ['https://cdn/1.jpg'], status: 'active', attributes: { Renk: 'Kahverengi', Beden: 'XL' } });
    expect(items[1]).toMatchObject({ externalId: 'NTBDFYNE0579', sku: 'SKU-L', status: 'paused', attributes: { Renk: 'Kahverengi', Beden: 'L' } });
    expect((items[0].raw as { commission: number }).commission).toBe(21.5);
  });
});
