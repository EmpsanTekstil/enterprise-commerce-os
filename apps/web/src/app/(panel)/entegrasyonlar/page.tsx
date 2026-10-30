'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, ErrorBox } from '@/components/ui';
import { api } from '@/lib/api';

interface Channel { id: string; code: string; name: string; kind: string; hasAdapter: boolean; capabilities: Record<string, { status: string; note?: string }> | null }
interface Account { id: string; label: string; status: string; lastError: string | null; lastSyncAt: string | null; externalSellerId: string | null; isDemo: boolean; channel: { code: string; name: string }; credentialSummary: Record<string, string> }

/** Kanal başına istenen kimlik alanları. Alan adları adaptörün beklediği anahtarlarla aynıdır. */
const CREDENTIAL_FIELDS: Record<string, { key: string; label: string; secret?: boolean }[]> = {
  trendyol: [{ key: 'supplierId', label: 'Satıcı ID (Cari ID)' }, { key: 'apiKey', label: 'API Key' }, { key: 'apiSecret', label: 'API Secret', secret: true }],
  hepsiburada: [{ key: 'merchantId', label: 'Merchant ID' }, { key: 'username', label: 'Entegrasyon kullanıcı adı' }, { key: 'password', label: 'Entegrasyon şifresi', secret: true }],
  amazon_tr: [{ key: 'sellerId', label: 'Seller ID' }, { key: 'clientId', label: 'LWA Client ID' }, { key: 'clientSecret', label: 'LWA Client Secret', secret: true }, { key: 'refreshToken', label: 'Refresh Token', secret: true }],
  n11: [{ key: 'appKey', label: 'App Key' }, { key: 'appSecret', label: 'App Secret', secret: true }, { key: 'integrator', label: 'Entegratör adı (isteğe bağlı)' }],
  idefix: [{ key: 'vendorId', label: 'Vendor ID (Satıcı ID)' }, { key: 'apiKey', label: 'API Key' }, { key: 'apiSecret', label: 'API Secret', secret: true }],
  mock: [{ key: 'apiKey', label: 'API Key (test için: test)' }],
  shopify: [{ key: 'shopDomain', label: 'Mağaza alan adı (ornek.myshopify.com)' }, { key: 'accessToken', label: 'Admin API Access Token (Custom app)', secret: true }],
};

const CAP_LABEL: Record<string, string> = {
  'products.read': 'Ürün okuma', 'products.create': 'Ürün oluşturma', 'products.update': 'Ürün güncelleme', 'stock.update': 'Stok güncelleme', 'price.update': 'Fiyat güncelleme',
  'orders.read': 'Sipariş okuma', 'shipping.update': 'Kargo işlemleri', 'returns.read': 'İade okuma', 'returns.update': 'İade işlemleri',
  'questions.read': 'Soru okuma', 'questions.answer': 'Soru cevaplama', 'reviews.read': 'Yorum okuma', 'reviews.reply': 'Yorum cevaplama',
  'ads.reports': 'Reklam raporları', 'ads.create': 'Reklam oluşturma', 'ads.budget': 'Reklam bütçesi', 'ads.pause': 'Reklam durdurma', 'categories.read': 'Kategori ağacı', webhooks: 'Webhook',
};
const CAP_TONE: Record<string, 'ok' | 'info' | 'warn' | 'bad' | 'neutral'> = { supported: 'ok', planned: 'info', conditional: 'warn', unsupported: 'bad', unverified: 'neutral' };
const CAP_TEXT: Record<string, string> = { supported: 'Destekleniyor', planned: 'Planlandı', conditional: 'Koşullu', unsupported: 'Desteklenmiyor', unverified: 'Doğrulanmadı' };
const STATUS_TEXT: Record<string, string> = { CONNECTED: 'Bağlı', ERROR: 'Hata', NOT_CONFIGURED: 'Test edilmedi', DISABLED: 'Kapalı' };

export default function IntegrationsPage() {
  const qc = useQueryClient();
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api<Channel[]>('/channels') });
  const accounts = useQuery({ queryKey: ['channel-accounts'], queryFn: () => api<Account[]>('/channels/accounts') });
  const [adding, setAdding] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [showCaps, setShowCaps] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  const create = useMutation({
    mutationFn: () => api('/channels/accounts', { method: 'POST', body: JSON.stringify({ channelCode: adding, label, credentials: creds, externalSellerId: creds.supplierId ?? creds.merchantId ?? creds.sellerId ?? creds.vendorId ?? creds.shopDomain }) }),
    onSuccess: () => { setAdding(null); setLabel(''); setCreds({}); qc.invalidateQueries({ queryKey: ['channel-accounts'] }); },
  });
  const test = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean; message: string }>(`/channels/accounts/${id}/test`, { method: 'POST' }),
    onSuccess: (r, id) => { setTestResult((t) => ({ ...t, [id]: r })); qc.invalidateQueries({ queryKey: ['channel-accounts'] }); },
  });
  const [webhook, setWebhook] = useState<{ url: string; header: string; key: string; note: string } | null>(null);
  const webhookKey = useMutation({ mutationFn: (id: string) => api<{ url: string; header: string; key: string; note: string }>(`/channels/accounts/${id}/webhook-key`, { method: 'POST' }), onSuccess: (r) => setWebhook(r) });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/channels/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channel-accounts'] }),
  });

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 font-medium">Bağlı hesaplar</div>
        {accounts.error && <ErrorBox message={(accounts.error as Error).message} />}
        {accounts.data?.length === 0 && <div className="card text-sm text-slate-500">Henüz hesap eklenmedi. Aşağıdan bir kanal seçip anahtarlarınızı girin.</div>}
        <div className="grid gap-3 md:grid-cols-2">
          {accounts.data?.map((a) => (
            <div key={a.id} className="card space-y-2" data-testid="account-card">
              <div className="flex items-center gap-2"><span className="font-medium">{a.channel.name}</span><span className="text-sm text-slate-500">{a.label}</span><span className="ml-auto"><Badge tone={a.status === 'CONNECTED' ? 'ok' : a.status === 'ERROR' ? 'bad' : 'warn'}>{STATUS_TEXT[a.status] ?? a.status}</Badge></span></div>
              <div className="text-xs text-slate-500">{Object.entries(a.credentialSummary).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>
              {(testResult[a.id] || a.lastError) && <div className={`text-xs ${testResult[a.id]?.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{testResult[a.id]?.message ?? a.lastError}</div>}
              <div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={() => test.mutate(a.id)} disabled={test.isPending}>Bağlantıyı test et</button>{channels.data?.find((c) => c.code === a.channel.code)?.capabilities?.webhooks?.status === 'supported' && <button className="btn-secondary" onClick={() => { if (confirm('Yeni webhook anahtarı üretilecek; eski anahtar geçersiz olur. Devam?')) webhookKey.mutate(a.id); }}>Webhook anahtarı</button>}<button className="btn-danger" onClick={() => { if (confirm('Hesap silinsin mi? İlan ve sipariş kayıtları da silinir.')) remove.mutate(a.id); }}>Sil</button></div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 font-medium">Kanal ekle</div>
        {channels.error && <ErrorBox message={(channels.error as Error).message} />}
        <div className="grid gap-3 md:grid-cols-3">
          {channels.data?.map((c) => (
            <div key={c.id} className="card space-y-2" data-testid={`channel-${c.code}`}>
              <div className="flex items-center gap-2"><span className="font-medium">{c.name}</span><Badge tone={c.kind === 'MARKETPLACE' ? 'info' : 'neutral'}>{c.kind === 'MARKETPLACE' ? 'Pazaryeri' : 'Mağaza'}</Badge></div>
              <div className="flex gap-2">
                <button className="btn-primary" onClick={() => { setAdding(c.code); setLabel(`${c.name} - Ana Mağaza`); setCreds({}); }}>Hesap ekle</button>
                <button className="btn-secondary" onClick={() => setShowCaps(showCaps === c.code ? null : c.code)}>Yetenekler</button>
              </div>
              {showCaps === c.code && c.capabilities && (
                <ul className="space-y-1 text-xs">{(Object.entries(c.capabilities) as [string, { status: string; note?: string }][]).map(([k, v]) => <li key={k} className="flex items-center gap-2"><span>{CAP_LABEL[k] ?? k}</span><span className="ml-auto"><Badge tone={CAP_TONE[v.status] ?? 'neutral'}>{CAP_TEXT[v.status] ?? v.status}</Badge></span></li>)}</ul>
              )}
            </div>
          ))}
        </div>
      </section>

      {webhook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setWebhook(null)}>
          <div className="card w-full max-w-lg space-y-2 text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="font-medium">Webhook bilgileri</div>
            <div><span className="text-slate-500">URL:</span> <code className="break-all">{webhook.url}</code></div>
            <div><span className="text-slate-500">Başlık:</span> <code>{webhook.header}</code></div>
            <div><span className="text-slate-500">Anahtar:</span> <code className="break-all">{webhook.key}</code></div>
            <div className="text-xs text-amber-700">{webhook.note} Uygulamanın internetten erişilebilir bir adresi (PUBLIC_API_URL) olmalıdır; localhost adresine kanal ulaşamaz.</div>
            <button className="btn-secondary" onClick={() => setWebhook(null)}>Kapat</button>
          </div>
        </div>
      )}
      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAdding(null)}>
          <form className="card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <div className="font-medium">{channels.data?.find((c) => c.code === adding)?.name} hesabı ekle</div>
            <div><label className="label" htmlFor="acc-label">Hesap etiketi</label><input id="acc-label" className="input" required value={label} onChange={(e) => setLabel(e.target.value)} /></div>
            {(CREDENTIAL_FIELDS[adding] ?? []).map((f) => (
              <div key={f.key}><label className="label" htmlFor={`cred-${f.key}`}>{f.label}</label><input id={`cred-${f.key}`} className="input" type={f.secret ? 'password' : 'text'} required autoComplete="off" value={creds[f.key] ?? ''} onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })} /></div>
            ))}
            <div className="text-xs text-slate-500">Anahtarlar sunucuda şifrelenerek saklanır; tarayıcıda tutulmaz.</div>
            {create.error && <ErrorBox message={(create.error as Error).message} />}
            <div className="flex gap-2"><button className="btn-primary" disabled={create.isPending}>Kaydet</button><button type="button" className="btn-secondary" onClick={() => setAdding(null)}>Vazgeç</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
