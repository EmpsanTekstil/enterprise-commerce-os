import { clampPrice, priceForMargin, profit } from './pricing.calc';

describe('Fiyat/kârlılık hesabı', () => {
  const base = { vatRate: 20, costPrice: 100, commissionPercent: 15, shippingCost: 40, packagingCost: 5, otherCostPercent: 2 };
  it('kâr dökümü doğru', () => {
    const p = profit({ ...base, salePrice: 300 });
    expect(p.netSale).toBe(250); expect(p.vat).toBe(50); expect(p.commission).toBe(45); expect(p.other).toBe(6);
    expect(p.grossProfit).toBe(150); expect(p.netProfit).toBe(150 - 45 - 40 - 5 - 6); expect(p.marginPercent).toBe(21.6);
  });
  it('hedef marj için fiyat, geri hesaplandığında marjı tutturur', () => {
    const price = priceForMargin({ ...base, targetMarginPercent: 20 })!;
    const p = profit({ ...base, salePrice: price });
    expect(Math.abs(p.marginPercent - 20)).toBeLessThan(0.2);
  });
  it('imkânsız kombinasyonda null', () => {
    expect(priceForMargin({ ...base, commissionPercent: 90, targetMarginPercent: 30 })).toBeNull();
  });
  it('limit kırpma', () => {
    expect(clampPrice(50, 80, 500)).toEqual({ price: 80, clamped: 'min' });
    expect(clampPrice(600, 80, 500)).toEqual({ price: 500, clamped: 'max' });
    expect(clampPrice(200, 80, 500)).toEqual({ price: 200 });
  });
});
