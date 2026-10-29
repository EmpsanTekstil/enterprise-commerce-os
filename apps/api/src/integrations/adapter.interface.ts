/**
 * KANAL ADAPTÖRÜ SÖZLEŞMESİ
 * -------------------------
 * Her satış kanalı (pazaryeri veya kendi mağaza platformu) bu arayüzü uygular.
 * Adaptör, desteklediği işlemleri `capabilities` ile bildirir; desteklemediği
 * işlem çağrılırsa `UnsupportedOperationError` fırlatır — asla sahte başarı döndürmez.
 */

export type CapabilityKey =
  | 'products.read'
  | 'products.create'
  | 'products.update'
  | 'stock.update'
  | 'price.update'
  | 'orders.read'
  | 'shipping.update'
  | 'returns.read'
  | 'returns.update'
  | 'questions.read'
  | 'questions.answer'
  | 'reviews.read'
  | 'reviews.reply'
  | 'ads.reports'
  | 'ads.create'
  | 'ads.budget'
  | 'ads.pause'
  | 'categories.read'
  | 'webhooks';

export type CapabilityStatus =
  | 'supported'      // resmî dokümanla doğrulandı ve uygulandı
  | 'planned'        // resmî dokümanda var, henüz kodlanmadı
  | 'conditional'    // ayrı onay/program gerektiriyor
  | 'unsupported'    // kanal API'si sunmuyor
  | 'unverified';    // doküman bulunamadı / doğrulanmadı

export interface CapabilityInfo {
  status: CapabilityStatus;
  docUrl?: string;
  note?: string;
}

export type CapabilityMatrix = Record<CapabilityKey, CapabilityInfo>;

export class UnsupportedOperationError extends Error {
  constructor(channel: string, capability: CapabilityKey) {
    super(`${channel} adaptörü '${capability}' işlemini desteklemiyor`);
    this.name = 'UnsupportedOperationError';
  }
}

/** Hesap bazlı kimlik bilgileri; veritabanından şifresi çözülmüş hali. Adaptör dışına çıkmaz. */
export type ChannelCredentials = Record<string, string>;

export interface AdapterContext {
  accountId: string;
  externalSellerId?: string | null;
  credentials: ChannelCredentials;
  settings: Record<string, unknown>;
}

// --- Normalize edilmiş (kanal-bağımsız) veri tipleri ---

export interface ExternalProduct {
  externalId: string;
  sku?: string;
  barcode?: string;
  title: string;
  description?: string;
  brand?: string;
  categoryExternalId?: string;
  price?: number;
  salePrice?: number;
  stock?: number;
  images?: string[];
  attributes?: Record<string, string>;
  status?: string;
  raw: unknown;
}

export interface ExternalOrder {
  externalId: string;
  orderNumber?: string;
  status: string;
  orderedAt: Date;
  customer?: { name?: string; email?: string; phone?: string };
  shippingAddress?: Record<string, unknown>;
  currency: string;
  grandTotal: number;
  items: {
    externalId?: string;
    sku?: string;
    barcode?: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    commission?: number;
  }[];
  shipment?: { carrierName?: string; trackingNumber?: string; trackingUrl?: string; status?: string };
  raw: unknown;
}

export interface ExternalQuestion {
  externalId: string;
  productExternalId?: string;
  customerName?: string;
  text: string;
  askedAt: Date;
  status: string;
  raw: unknown;
}

export interface ExternalReview {
  externalId: string;
  productExternalId?: string;
  rating: number;
  title?: string;
  text?: string;
  customerName?: string;
  reviewedAt: Date;
  raw: unknown;
}

export interface ExternalCategory {
  externalId: string;
  parentExternalId?: string;
  name: string;
  isLeaf: boolean;
}

export interface PushResult {
  ok: boolean;
  externalId?: string;
  batchRequestId?: string;
  error?: string;
}

export interface PagedResult<T> {
  items: T[];
  nextCursor?: string;
  total?: number;
}

/** Her kanal adaptörünün uygulaması gereken arayüz. */
export interface ChannelAdapter {
  readonly code: string;          // "trendyol", "shopify"...
  readonly displayName: string;
  readonly capabilities: CapabilityMatrix;

  /** Kimlik bilgilerinin doğruluğunu kanal API'sine gerçek bir çağrıyla test eder. */
  testConnection(ctx: AdapterContext): Promise<{ ok: boolean; message: string }>;

  fetchCategories?(ctx: AdapterContext): Promise<ExternalCategory[]>;
  fetchCategoryAttributes?(ctx: AdapterContext, categoryExternalId: string): Promise<unknown>;

  fetchProducts?(ctx: AdapterContext, cursor?: string): Promise<PagedResult<ExternalProduct>>;
  createProducts?(ctx: AdapterContext, products: ExternalProduct[]): Promise<PushResult[]>;
  updateProducts?(ctx: AdapterContext, products: ExternalProduct[]): Promise<PushResult[]>;
  updateStockAndPrice?(
    ctx: AdapterContext,
    items: { externalId?: string; barcode?: string; sku?: string; stock?: number; price?: number; salePrice?: number }[],
  ): Promise<PushResult[]>;

  fetchOrders?(ctx: AdapterContext, since: Date, cursor?: string): Promise<PagedResult<ExternalOrder>>;
  updateShipment?(ctx: AdapterContext, orderExternalId: string, data: { trackingNumber?: string; carrierCode?: string; status?: string }): Promise<PushResult>;

  fetchQuestions?(ctx: AdapterContext, since: Date, cursor?: string): Promise<PagedResult<ExternalQuestion>>;
  answerQuestion?(ctx: AdapterContext, questionExternalId: string, text: string): Promise<PushResult>;

  fetchReviews?(ctx: AdapterContext, since: Date, cursor?: string): Promise<PagedResult<ExternalReview>>;
  replyReview?(ctx: AdapterContext, reviewExternalId: string, text: string): Promise<PushResult>;
}
