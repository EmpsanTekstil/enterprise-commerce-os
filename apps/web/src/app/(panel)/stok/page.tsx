'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Empty, ErrorBox } from '@/components/ui';
import { api } from '@/lib/api';

interface Warehouse { id: string; name: string; code: string; isDefault: boolean; _count: { balances: number } }
interface Balance { id: string; onHand: number; reserved: number; reorderPoint: number; available: number; isLow: boolean; warehouse: { id: string; name: string; code: string }; variant: { id: string; sku: string; barcode: string | null; color: string | null; size: string | null; product: { id: string; name: string }; listings: { stockQuantity: number | null; status: string; channelAccount: { label: string; channel: { name: string } } }[] } }
interface Movement { id: string; type: string; quantity: number; note: string | null; createdAt: string; warehouse: { name: string } }
interface Policy { id: string; channelAccountId: string; sharePercent: number; bufferQuantity: number; maxQuantity: number | null; autoPush: boolean; channelAccount: { id: string; label: string; channel: { name: string } } }
interface Account { id: string; label: string; status: string; channel: { name: string } }
interface Recon { mismatches: number; items: { listingId: string; sku: string; product: string; channel: string; expected: number; channelStock: number | null; diff: number | null }[] }

const MOV: Record<string, string> = { PURCHASE_IN: 'Alış girişi', SALE_OUT: 'Satış', RETURN_IN: 'İade girişi', ADJUSTMENT: 'Düzeltme', TRANSFER_IN: 'Transfer girişi', TRANSFER_OUT: 'Transfer çıkışı', RESERVE: 'Rezerve', RELEASE: 'Rezerve iptali' };

export default function InventoryPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'stok' | 'depolar' | 'politika' | 'mutabakat'>('stok');
  const [q, setQ] = useState(''); const [wh, setWh] = useState(''); const [lowOnly, setLowOnly] = useState(false);
  const [adjust, setAdjust] = useState<Balance | null>(null); const [form, setForm] = useState({ quantity: '', reorderPoint: '', note: '' });
  const [history, setHistory] = useState<Balance | null>(null);
  const [newWh, setNewWh] = useState({ name: '', code: '' });

  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => api<Warehouse[]>('/inventory/warehouses') });
  const balances = useQuery({ queryKey: ['balances', q, wh, lowOnly], queryFn: () => api<{ items: Balance[]; total: number }>(`/inventory/balances?pageSize=200&q=${encodeURIComponent(q)}${wh ? `&warehouseId=${wh}` : ''}${lowOnly ? '&lowOnly=true' : ''}`), enabled: tab === 'stok' });
  const movements = useQuery({ queryKey: ['movements', history?.variant.id], queryFn: () => api<Movement[]>(`/inventory/movements/${history!.variant.id}`), enabled: !!history });
  const policies = useQuery({ queryKey: ['policies'], queryFn: () => api<Policy[]>('/inventory/policies'), enabled: tab === 'politika' });
  const accounts = useQuery({ queryKey: ['channel-accounts'], queryFn: () => api<Account[]>('/channels/accounts'), enabled: tab === 'politika' });
  const recon = useQuery({ queryKey: ['reconciliation'], queryFn: () => api<Recon>('/inventory/reconciliation'), enabled: tab === 'mutabakat' });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['balances'] }); qc.invalidateQueries({ queryKey: ['warehouses'] }); qc.invalidateQueries({ queryKey: ['policies'] }); qc.invalidateQueries({ queryKey: ['reconciliation'] }); };

  const doAdjust = useMutation({ mutationFn: () => api('/inventory/adjust', { method: 'POST', body: JSON.stringify({ variantId: adjust!.variant.id, warehouseId: adjust!.warehouse.id, quantity: form.quantity === '' ? undefined : Number(form.quantity), reorderPoint: form.reorderPoint === '' ? undefined : Number(form.reorderPoint), note: form.note || undefined }) }), onSuccess: () => { setAdjust(null); refresh(); } });
  const createWh = useMutation({ mutationFn: () => api('/inventory/warehouses', { method: 'POST', body: JSON.stringify(newWh) }), onSuccess: () => { setNewWh({ name: '', code: '' }); refresh(); } });
  const savePolicy = useMutation({ mutationFn: (p: { accountId: string; sharePercent: number; bufferQuantity: number; maxQuantity: number | null }) => api(`/inventory/policies/${p.accountId}`, { method: 'PUT', body: JSON.stringify({ sharePercent: p.sharePercent, bufferQuantity: p.bufferQuantity, maxQuantity: p.maxQuantity }) }), onSuccess: refresh });
  const err = (doAdjust.error ?? createWh.error ?? savePolicy.error ?? balances.error) as Error | null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{([['stok', 'Stok bakiyeleri'], ['depolar', 'Depolar'], ['politika', 'Kanal stok politikası'], ['mutabakat', 'Mutabakat']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(k)}>{l}</button>)}</div>
      {err && <ErrorBox message={err.message} />}

      {tab === 'stok' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input max-w-xs" placeholder="Ürün, SKU, barkod ara" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input max-w-[200px]" value={wh} onChange={(e) => setWh(e.target.value)}><option value="">Tüm depolar</option>{warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Yalnızca kritik stok</label>
          </div>
          {balances.data?.items.length === 0 && <Empty title="Kayıt yok" />}
          {balances.data && balances.data.items.length > 0 && (
            <div className="card overflow-x-auto !p-0"><table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50"><tr><th className="px-3 py-2">Ürün</th><th className="px-3 py-2">Depo</th><th className="px-3 py-2 text-right">Fiziksel</th><th className="px-3 py-2 text-right">Rezerve</th><th className="px-3 py-2 text-right">Satılabilir</th><th className="px-3 py-2 text-right">Kritik eşik</th><th className="px-3 py-2">Kanallarda</th><th className="px-3 py-2"></th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {balances.data.items.map((b) => (
                  <tr key={b.id} className={b.isLow ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''}>
                    <td className="px-3 py-2"><div className="font-medium">{b.variant.product.name}</div><div className="font-mono text-xs text-slate-500">{b.variant.sku} {[b.variant.color, b.variant.size].filter(Boolean).join('/')}</div></td>
                    <td className="px-3 py-2">{b.warehouse.name}</td>
                    <td className="px-3 py-2 text-right">{b.onHand}</td><td className="px-3 py-2 text-right">{b.reserved}</td>
                    <td className="px-3 py-2 text-right font-medium">{b.available}{b.isLow && <Badge tone="bad">Kritik</Badge>}</td>
                    <td className="px-3 py-2 text-right">{b.reorderPoint}</td>
                    <td className="px-3 py-2 text-xs">{b.variant.listings.map((l, i) => <div key={i}>{l.channelAccount.channel.name}: {l.stockQuantity ?? '—'}</div>)}</td>
                    <td className="px-3 py-2 text-xs"><button className="text-brand-600 underline" onClick={() => { setAdjust(b); setForm({ quantity: String(b.onHand), reorderPoint: String(b.reorderPoint), note: '' }); }}>Düzelt</button> · <button className="text-brand-600 underline" onClick={() => setHistory(b)}>Geçmiş</button></td>
                  </tr>
                ))}
              </tbody></table></div>
          )}
        </>
      )}

      {tab === 'depolar' && (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">{warehouses.data?.map((w) => <div key={w.id} className="card"><div className="font-medium">{w.name} {w.isDefault && <Badge tone="info">Varsayılan</Badge>}</div><div className="text-sm text-slate-500">Kod: {w.code} · {w._count.balances} kayıt</div></div>)}</div>
          <form className="card flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); createWh.mutate(); }}>
            <div><label className="label">Depo adı</label><input className="input" required value={newWh.name} onChange={(e) => setNewWh({ ...newWh, name: e.target.value })} /></div>
            <div><label className="label">Kod</label><input className="input" required maxLength={20} value={newWh.code} onChange={(e) => setNewWh({ ...newWh, code: e.target.value })} /></div>
            <button className="btn-primary" disabled={createWh.isPending}>Depo ekle</button>
          </form>
        </div>
      )}

      {tab === 'politika' && (
        <div className="space-y-3">
          <div className="text-sm text-slate-500">Kanala gönderilen stok = (satılabilir − tampon) × pay %, üst sınır varsa onunla sınırlanır. Birden fazla kanalda aynı stoğu satıyorsanız payı düşürün veya tampon bırakın.</div>
          {accounts.data?.map((a) => { const p = policies.data?.find((x) => x.channelAccountId === a.id); return <PolicyRow key={a.id} account={a} policy={p} onSave={(v) => savePolicy.mutate({ accountId: a.id, ...v })} />; })}
        </div>
      )}

      {tab === 'mutabakat' && (
        <div className="space-y-3">
          <div className="card text-sm">{recon.data ? <>{recon.data.mismatches} ilanda kanal stoğu merkezi stoktan farklı. Farkları düzeltmek için Pazaryeri Yayınları → "Stok/fiyat gönder".</> : 'Hesaplanıyor…'}</div>
          {recon.data && recon.data.items.length > 0 && (
            <div className="card overflow-x-auto !p-0"><table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50"><tr><th className="px-3 py-2">Ürün</th><th className="px-3 py-2">Kanal</th><th className="px-3 py-2 text-right">Olması gereken</th><th className="px-3 py-2 text-right">Kanalda</th><th className="px-3 py-2 text-right">Fark</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{recon.data.items.map((i) => <tr key={i.listingId}><td className="px-3 py-2">{i.product}<div className="font-mono text-xs text-slate-500">{i.sku}</div></td><td className="px-3 py-2">{i.channel}</td><td className="px-3 py-2 text-right">{i.expected}</td><td className="px-3 py-2 text-right">{i.channelStock ?? '—'}</td><td className={`px-3 py-2 text-right ${(i.diff ?? 0) < 0 ? 'text-rose-600' : 'text-amber-600'}`}>{i.diff == null ? '—' : i.diff > 0 ? `+${i.diff}` : i.diff}</td></tr>)}</tbody></table></div>
          )}
        </div>
      )}

      {adjust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAdjust(null)}>
          <form className="card w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); doAdjust.mutate(); }}>
            <div className="font-medium">{adjust.variant.product.name} · {adjust.variant.sku}</div><div className="text-sm text-slate-500">{adjust.warehouse.name}</div>
            <div><label className="label">Fiziksel stok (sayım sonucu)</label><input className="input" type="number" min={0} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
            <div><label className="label">Kritik stok eşiği</label><input className="input" type="number" min={0} value={form.reorderPoint} onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })} /></div>
            <div><label className="label">Not</label><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            <div className="flex gap-2"><button className="btn-primary" disabled={doAdjust.isPending}>Kaydet</button><button type="button" className="btn-secondary" onClick={() => setAdjust(null)}>Vazgeç</button></div>
          </form>
        </div>
      )}
      {history && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setHistory(null)}>
          <div className="card max-h-[80vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 font-medium">Stok hareketleri · {history.variant.sku}</div>
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">{movements.data?.map((m) => <li key={m.id} className="flex gap-2 py-1.5"><span className="text-xs text-slate-500">{new Date(m.createdAt).toLocaleString('tr-TR')}</span><span>{MOV[m.type] ?? m.type}</span><span className={`font-mono ${m.quantity < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span><span className="text-slate-500">{m.warehouse.name}</span><span className="text-xs text-slate-500">{m.note}</span></li>)}</ul>
            <button className="btn-secondary mt-3" onClick={() => setHistory(null)}>Kapat</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PolicyRow({ account, policy, onSave }: { account: Account; policy?: Policy; onSave: (v: { sharePercent: number; bufferQuantity: number; maxQuantity: number | null }) => void }) {
  const [v, setV] = useState({ sharePercent: String(policy?.sharePercent ?? 100), bufferQuantity: String(policy?.bufferQuantity ?? 0), maxQuantity: policy?.maxQuantity == null ? '' : String(policy.maxQuantity) });
  return (
    <div className="card flex flex-wrap items-end gap-3 text-sm">
      <div className="min-w-[180px]"><div className="font-medium">{account.channel.name}</div><div className="text-slate-500">{account.label}</div></div>
      <div><label className="label">Pay (%)</label><input className="input w-24" type="number" min={0} max={100} value={v.sharePercent} onChange={(e) => setV({ ...v, sharePercent: e.target.value })} /></div>
      <div><label className="label">Tampon (adet)</label><input className="input w-24" type="number" min={0} value={v.bufferQuantity} onChange={(e) => setV({ ...v, bufferQuantity: e.target.value })} /></div>
      <div><label className="label">Üst sınır</label><input className="input w-24" type="number" min={0} placeholder="yok" value={v.maxQuantity} onChange={(e) => setV({ ...v, maxQuantity: e.target.value })} /></div>
      <button className="btn-secondary" onClick={() => onSave({ sharePercent: Number(v.sharePercent), bufferQuantity: Number(v.bufferQuantity), maxQuantity: v.maxQuantity === '' ? null : Number(v.maxQuantity) })}>Kaydet</button>
    </div>
  );
}
