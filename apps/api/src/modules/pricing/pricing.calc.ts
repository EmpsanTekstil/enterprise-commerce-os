/** Fiyat/kârlılık hesabı — saf fonksiyonlar (birim testli). Tüm tutarlar TL, KDV dahil satış fiyatı üzerinden. */
export interface CostInputs {
  salePrice: number;          // KDV dahil satış fiyatı
  vatRate: number;            // %
  costPrice: number;          // KDV hariç alış maliyeti
  commissionPercent: number;  // satış fiyatı üzerinden %
  shippingCost: number;       // TL
  packagingCost: number;      // TL
  otherCostPercent: number;   // satış fiyatı üzerinden %
  adCostPerUnit?: number;     // TL (reklam harcaması / satılan adet)
}

export interface ProfitBreakdown {
  salePrice: number; netSale: number; vat: number; commission: number; shipping: number; packaging: number; other: number; ad: number; cost: number;
  grossProfit: number; netProfit: number; marginPercent: number; // net kâr / KDV hariç satış
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function profit(i: CostInputs): ProfitBreakdown {
  const netSale = i.salePrice / (1 + i.vatRate / 100);
  const vat = i.salePrice - netSale;
  const commission = (i.salePrice * i.commissionPercent) / 100;
  const other = (i.salePrice * i.otherCostPercent) / 100;
  const ad = i.adCostPerUnit ?? 0;
  const grossProfit = netSale - i.costPrice;
  const netProfit = grossProfit - commission - i.shippingCost - i.packagingCost - other - ad;
  return { salePrice: r2(i.salePrice), netSale: r2(netSale), vat: r2(vat), commission: r2(commission), shipping: r2(i.shippingCost), packaging: r2(i.packagingCost), other: r2(other), ad: r2(ad), cost: r2(i.costPrice), grossProfit: r2(grossProfit), netProfit: r2(netProfit), marginPercent: netSale > 0 ? r2((netProfit / netSale) * 100) : 0 };
}

/**
 * Hedef net kâr marjına (KDV hariç satış üzerinden %) ulaşan KDV dahil satış fiyatı.
 * netSale*(1-m) = cost + comm%*sale + other%*sale + fixed  →  sale*(1/(1+v))*(1-m) - sale*(comm+other) = cost+fixed
 */
export function priceForMargin(i: Omit<CostInputs, 'salePrice'> & { targetMarginPercent: number }): number | null {
  const v = i.vatRate / 100, m = i.targetMarginPercent / 100, pct = (i.commissionPercent + i.otherCostPercent) / 100;
  const fixed = i.shippingCost + i.packagingCost + (i.adCostPerUnit ?? 0);
  const k = (1 - m) / (1 + v) - pct;
  if (k <= 0) return null; // bu komisyon/marj kombinasyonunda fiyat yok
  return r2((i.costPrice + fixed) / k);
}

/** Güvenli limit kontrolü: önerilen fiyat min/max dışındaysa kırpılır ve neden döner. */
export function clampPrice(p: number, min?: number | null, max?: number | null): { price: number; clamped?: 'min' | 'max' } {
  if (min != null && p < min) return { price: min, clamped: 'min' };
  if (max != null && p > max) return { price: max, clamped: 'max' };
  return { price: p };
}
