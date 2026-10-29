import { Injectable, NotFoundException } from '@nestjs/common';
import { ChannelAdapter } from './adapter.interface';
import { TrendyolAdapter } from './trendyol/trendyol.adapter';
import { PlaceholderAdapter } from './placeholder.adapter';
import { MockAdapter } from './mock/mock.adapter';

/**
 * Kanal adaptörlerinin tek kayıt noktası.
 * Yeni kanal eklemek: bir adaptör sınıfı yaz, buradaki listeye ekle, SalesChannel seed'ine `code` ekle.
 */
@Injectable()
export class AdapterRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>();

  constructor() {
    const list: ChannelAdapter[] = [
      new TrendyolAdapter(),
      // Aşağıdakiler yetenek matrisi doğrulandıkça gerçek adaptörlerle değiştirilecek.
      new PlaceholderAdapter('hepsiburada', 'Hepsiburada'),
      new PlaceholderAdapter('amazon_tr', 'Amazon Türkiye'),
      new PlaceholderAdapter('n11', 'n11'),
      new PlaceholderAdapter('idefix', 'idefix'),
      new PlaceholderAdapter('shopify', 'Shopify'),
    ];
    if (process.env.ENABLE_MOCK_CHANNEL === '1' || process.env.NODE_ENV === 'test') list.push(new MockAdapter());
    for (const a of list) this.adapters.set(a.code, a);
  }

  get(code: string): ChannelAdapter {
    const a = this.adapters.get(code);
    if (!a) throw new NotFoundException(`Kanal adaptörü bulunamadı: ${code}`);
    return a;
  }

  list(): { code: string; displayName: string; capabilities: ChannelAdapter['capabilities'] }[] {
    return [...this.adapters.values()].map((a) => ({
      code: a.code,
      displayName: a.displayName,
      capabilities: a.capabilities,
    }));
  }
}
