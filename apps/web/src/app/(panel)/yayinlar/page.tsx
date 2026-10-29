'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CategoryMapping } from '@/components/category-mapping';
import { Badge, Empty, ErrorBox } from '@/components/ui';
import { api, fmtTRY } from '@/lib/api';

interface Account { id: string; label: string; status: string; channel: { code: string; name: string } }
interface Suggestion { variantId: string; confidence: string; reason: string; variant: { sku: string; barcode: string | null; product: { name: string } } | null }
interface Listing { id: string; externalId: string; externalSku: string | null; title: string | null; price: string | null; stockQuantity: number | null; status: string; lastError: string | null; lastSyncedAt: string | null; variantId: string | null; variant: { sku: string; product: { id: string; name: string } } | null; matchSuggestions: Suggestion[]; channelAccount: { label: string; channel: { name: string } } }
interface Job { id: string; type: string; status: string; error: string | null; result: Record<string, unknown> | null; createdAt: string; channelAccount: { label: string } }

const STATUS: Record<string, { l: string; t: 'ok' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  ACTIVE: { l: 'Yayında', t: 'ok' }, PENDING: { l: 'Onay bekliyor', t: 'info' }, PAUSED: { l: 'Durduruldu', t: 'neutral' }, REJECTED: { l: 'Reddedildi', t: 'bad' },
  ERROR: { l: 'Hata', t: 'bad' }, DRAFT: { l: 'Taslak', t: 'warn' }, UNLINKED: { l: 'Eşleşmedi', t: 'warn' },
};
const JOB: Record<string, string> = { CATEGORY_PULL: 'Kategori çekme', PRODUCT_PULL: 'Ürün içe aktarma', ORDER_PULL: 'Sipariş çekme', STOCK_PUSH: 'Stok gönderme', PRICE_PUSH: 'Fiyat gönderme', BATCH_CHECK: 'Onay sonucu sorgulama', RETURN_PULL: 'İade çekme' };

export default function ListingsPage() {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const accounts = useQuery({ queryKey: ['channel-accounts'], queryFn: () => api<Account[]>('/channels/accounts') });
  const listings = useQuery({
    queryKey: ['listings', accountId, status, q],
    queryFn: () => api<{ items: Listing[]; total: number }>(`/listings?pageSize=100${accountId ? `&accountId=${accountId}` : ''}${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  });
  const jobs = useQuery({ queryKey: ['sync-jobs', accountId], queryFn: () => api<Job[]>(`/sync/jobs${accountId ? `?accountId=${accountId}` : ''}`), refetchInterval: 10_000 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['listings'] }); qc.invalidateQueries({ queryKey: ['sync-jobs'] }); qc.invalidateQueries({ queryKey: ['products'] }); };

  const run = useMutation({ mutationFn: (type: string) => api<{ status?: string; error?: string }>(`/sync/accounts/${accountId}/run`, { method: 'POST', body: JSON.stringify({ type }) }), onSuccess: refresh });
  const link = useMutation({ mutationFn: (p: { id: string; variantId: string }) => api(`/listings/${p.id}/link`, { method: 'POST', body: JSON.stringify({ variantId: p.variantId }) }), onSuccess: refresh });
  const createProduct = useMutation({ mutationFn: (id: string) => api(`/listings/${id}/create-product`, { method: 'POST' }), onSuccess: refresh });
  const [editing, setEditing] = useState<Listing | null>(null);
  const [form, setForm] = useState({ title: '', price: '', salePrice: '' });
  const saveListing = useMutation({ mutationFn: () => api(`/listings/${editing!.id}`, { method: 'PATCH', body: JSON.stringify({ title: form.title || undefined, price: form.price ? Number(form.price) : undefined, salePrice: form.salePrice ? Number(form.salePrice) : undefined }) }), onSuccess: () => { setEditing(null); refresh(); } });
  const acceptAll = useMutation({ mutationFn: () => api<{ linked: number; skipped: number }>('/listings/accept-suggestions', { method: 'POST', body: JSON.stringify({ accountId }) }), onSuccess: refresh });

  const err = (run.error ?? link.error ?? createProduct.error ?? acceptAll.error ?? listings.error) as Error | null;
  const connected = accounts.data?.filter((a) => a.status === 'CONNECTED') ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-xs" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Tüm kanal hesapları</option>
          {accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.channel.name} · {a.label}{a.status !== 'CONNECTED' ? ' (bağlı değil)' : ''}</option>)}
        </select>
        <select className="input max-w-[170px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tüm durumlar</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
        </select>
        <input className="input max-w-xs" placeholder="Başlık, SKU, barkod ara" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {accountId && connected.some((a) => a.id === accountId) && (
        <div className="card flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Bu hesap için:</span>
          <button className="btn-secondary" disabled={run.isPending} onClick={() => run.mutate('CATEGORY_PULL')}>Kategorileri çek</button>
          <button className="btn-primary" disabled={run.isPending} onClick={() => run.mutate('PRODUCT_PULL')}>Ürünleri içe aktar</button>
          <button className="btn-secondary" disabled={run.isPending} onClick={() => run.mutate('ORDER_PULL')}>Siparişleri çek</button>
          <button className="btn-secondary" disabled={run.isPending} onClick={() => run.mutate('RETURN_PULL')}>İadeleri çek</button>
          <button className="btn-secondary" disabled={run.isPending} onClick={() => { if (confirm('Merkezi stok ve fiyatlar bu kanala gönderilecek. Devam?')) run.mutate('STOCK_PUSH'); }}>Stok/fiyat gönder</button>
          <button className="btn-secondary" disabled={acceptAll.isPending} onClick={() => acceptAll.mutate()}>Barkod eşleşmelerini kabul et</button>
          <button className="btn-secondary" disabled={run.isPending} onClick={() => run.mutate('BATCH_CHECK')}>Onay sonuçlarını sorgula</button>
          {run.data?.status && <span className={`text-sm ${run.data.status === 'SUCCESS' ? 'text-emerald-600' : 'text-rose-600'}`}>{run.data.status === 'SUCCESS' ? 'Tamamlandı' : `Hata: ${run.data.error}`}</span>}
          {acceptAll.data && <span className="text-sm text-slate-500">{acceptAll.data.linked} bağlandı, {acceptAll.data.skipped} çakışma/atlandı</span>}
        </div>
      )}
      {accountId && !connected.some((a) => a.id === accountId) && <div className="card text-sm text-amber-700">Bu hesap bağlı değil. Entegrasyonlar sayfasından "Bağlantıyı test et" ile bağlayın.</div>}
      {err && <ErrorBox message={err.message} />}

      {accountId && connected.some((a) => a.id === accountId) && (
        <details className="card"><summary className="cursor-pointer font-medium">Kategori eşleştirme</summary><div className="mt-3"><CategoryMapping accountId={accountId} /></div></details>
      )}

      {listings.data?.items.length === 0 && <Empty title="İlan yok" hint="Bir kanal hesabı seçip 'Ürünleri içe aktar' ile başlayın." />}
      {listings.data && listings.data.items.length > 0 && (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50"><tr><th className="px-3 py-2">Kanal</th><th className="px-3 py-2">İlan</th><th className="px-3 py-2 text-right">Fiyat</th><th className="px-3 py-2 text-right">Kanal stoğu</th><th className="px-3 py-2">Merkezi ürün</th><th className="px-3 py-2">Durum</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {listings.data.items.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="px-3 py-2"><div className="font-medium">{l.channelAccount.channel.name}</div><div className="text-xs text-slate-500">{l.channelAccount.label}</div></td>
                  <td className="px-3 py-2"><div>{l.title ?? '—'}</div><div className="font-mono text-xs text-slate-500">{l.externalSku ?? ''} · {l.externalId}</div>{l.lastError && <div className="text-xs text-rose-600">{l.lastError}</div>}</td>
                  <td className="px-3 py-2 text-right">{l.price ? fmtTRY(Number(l.price)) : '—'}</td>
                  <td className="px-3 py-2 text-right">{l.stockQuantity ?? '—'}</td>
                  <td className="px-3 py-2">
                    {l.variant ? (<div><div>{l.variant.product.name}</div><div className="font-mono text-xs text-slate-500">{l.variant.sku}</div></div>) : (
                      <div className="space-y-1">
                        {l.matchSuggestions.map((s) => (
                          <div key={s.variantId} className="flex flex-wrap items-center gap-2 text-xs">
                            <Badge tone={Number(s.confidence) >= 95 ? 'ok' : 'warn'}>%{Number(s.confidence)} {s.reason}</Badge>
                            <span>{s.variant?.product.name} ({s.variant?.sku})</span>
                            <button className="btn-secondary !px-2 !py-0.5 text-xs" onClick={() => link.mutate({ id: l.id, variantId: s.variantId })}>Bağla</button>
                          </div>
                        ))}
                        {l.matchSuggestions.length === 0 && <button className="btn-secondary !px-2 !py-0.5 text-xs" onClick={() => createProduct.mutate(l.id)}>Merkezi ürün oluştur</button>}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2"><Badge tone={STATUS[l.status]?.t ?? 'neutral'}>{STATUS[l.status]?.l ?? l.status}</Badge>{l.variant && <button className="mt-1 block text-xs text-brand-600 underline" onClick={() => { setEditing(l); setForm({ title: l.title ?? '', price: l.price ?? '', salePrice: '' }); }}>Düzenle</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <form className="card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); saveListing.mutate(); }}>
            <div className="font-medium">Kanal-özel ilan bilgisi · {editing.channelAccount.channel.name}</div>
            <div><label className="label">Başlık (en fazla 100)</label><input className="input" maxLength={100} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2"><div><label className="label">Liste fiyatı</label><input className="input" type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div><div><label className="label">İndirimli fiyat</label><input className="input" type="number" step="0.01" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} /></div></div>
            <div className="text-xs text-slate-500">Boş bırakılan alanlar merkezi üründen alınır. Değişiklik kanala "Stok/fiyat gönder" veya yeniden yayınlama ile gider.</div>
            {saveListing.error && <ErrorBox message={(saveListing.error as Error).message} />}
            <div className="flex gap-2"><button className="btn-primary" disabled={saveListing.isPending}>Kaydet</button><button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Vazgeç</button></div>
          </form>
        </div>
      )}

      <section className="card">
        <div className="mb-2 font-medium">Senkronizasyon geçmişi</div>
        {jobs.data?.length === 0 && <div className="text-sm text-slate-500">Henüz iş çalışmadı.</div>}
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {jobs.data?.slice(0, 15).map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="text-xs text-slate-500">{new Date(j.createdAt).toLocaleString('tr-TR')}</span>
              <span>{j.channelAccount.label}</span><span className="text-slate-500">{JOB[j.type] ?? j.type}</span>
              <Badge tone={j.status === 'SUCCESS' ? 'ok' : j.status === 'FAILED' ? 'bad' : 'info'}>{j.status === 'SUCCESS' ? 'Başarılı' : j.status === 'FAILED' ? 'Başarısız' : j.status === 'RUNNING' ? 'Çalışıyor' : 'Kuyrukta'}</Badge>
              {j.result && <span className="text-xs text-slate-500">{Object.entries(j.result).filter(([k]) => k !== 'touchedVariants').map(([k, v]) => `${k}: ${v}`).join(' · ')}</span>}
              {j.error && <span className="text-xs text-rose-600">{j.error}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
