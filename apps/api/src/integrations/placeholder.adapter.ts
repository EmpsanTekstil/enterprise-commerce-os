import { AdapterContext, CapabilityKey, CapabilityMatrix, ChannelAdapter } from './adapter.interface';

const KEYS: CapabilityKey[] = [
  'products.read', 'products.create', 'products.update', 'stock.update', 'price.update',
  'orders.read', 'shipping.update', 'returns.read', 'returns.update',
  'questions.read', 'questions.answer', 'reviews.read', 'reviews.reply',
  'ads.reports', 'ads.create', 'ads.budget', 'ads.pause', 'categories.read', 'webhooks',
];

/**
 * Henüz uygulanmamış kanallar için dürüst yer tutucu:
 * tüm yetenekler 'unverified', bağlantı testi her zaman "uygulanmadı" döner.
 * Arayüz bu kanalları "Yakında" olarak gösterir; sahte bağlantı yoktur.
 */
export class PlaceholderAdapter implements ChannelAdapter {
  readonly capabilities: CapabilityMatrix;

  constructor(public readonly code: string, public readonly displayName: string) {
    this.capabilities = Object.fromEntries(
      KEYS.map((k) => [k, { status: 'unverified', note: 'Adaptör henüz uygulanmadı' }]),
    ) as CapabilityMatrix;
  }

  async testConnection(_ctx: AdapterContext) {
    return { ok: false, message: `${this.displayName} adaptörü henüz uygulanmadı.` };
  }
}
