'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Empty, ErrorBox } from '@/components/ui';
import { api, fmtTRY } from '@/lib/api';

interface Rule { id: string; name: string; channelAccountId: string | null; commissionPercent: string; shippingCost: string; packagingCost: string; otherCostPercent: string; targetMarginPercent: string; minPrice: string | null; maxPrice: string | null; isActive: boolean; channelAccount: { label: string; channel: { name: string } } | null }
interface Proposal { id: string; productName: string | null; variantSku: string | null; channelName: string; accountLabel: string; currentPrice: string | null; proposedPrice: string; reason: string; breakdownJson: { netProfit: number; marginPercent: number } | null; createdAt: string }
interface Account { id: string; label: string; channel: { name: string } }
const empty = { name: '', channelAccountId: '', commissionPercent: '15', shippingCost: '40', packagingCost: '5', otherCostPercent: '2', targetMarginPercent: '20', minPrice: '', maxPrice: '' };

export default function PricingPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState(empty); const [editId, setEditId] = useState<string | null>(null); const [sel, setSel] = useState<string[]>([]); const [genAcc, setGenAcc] = useState('');
  const rules = useQuery({ queryKey: ['pricing-rules'], queryFn: () => api<Rule[]>('/pricing/rules') });
  const accounts = useQuery({ queryKey: ['channel-accounts'], queryFn: () => api<Account[]>('/channels/accounts') });
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: () => api<Proposal[]>('/pricing/proposals') });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['pricing-rules'] }); qc.invalidateQueries({ queryKey: ['proposals'] }); setSel([]); };
  const body = () => ({ name: form.name, channelAccountId: form.channelAccountId || null, commissionPercent: +form.commissionPercent, shippingCost: +form.shippingCost, packagingCost: +form.packagingCost, otherCostPercent: +form.otherCostPercent, targetMarginPercent: +form.targetMarginPercent, minPrice: form.minPrice ? +form.minPrice : null, maxPrice: form.maxPrice ? +form.maxPrice : null });
  const save = useMutation({ mutationFn: () => api(editId ? `/pricing/rules/${editId}` : '/pricing/rules', { method: editId ? 'PUT' : 'POST', body: JSON.stringify(body()) }), onSuccess: () => { setForm(empty); setEditId(null); refresh(); } });
  const del = useMutation({ mutationFn: (id: string) => api(`/pricing/rules/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const gen = useMutation({ mutationFn: () => api<{ created: number; skipped: number }>('/pricing/proposals/generate', { method: 'POST', body: JSON.stringify({ channelAccountId: genAcc || undefined }) }), onSuccess: refresh });
  const decide = useMutation({ mutationFn: (p: { ids: string[]; approve: boolean }) => api(`/pricing/proposals/${p.approve ? 'approve' : 'reject'}`, { method: 'POST', body: JSON.stringify({ ids: p.ids }) }), onSuccess: refresh });
  const err = (save.error ?? gen.error ?? decide.error ?? proposals.error) as Error | null;
  const F = (k: keyof typeof empty, label: string, type = 'number') => <div><label className="label">{label}</label><input className="input" type={type} step="0.01" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>;

  return (
    <div className="space-y-4">
      {err && <ErrorBox message={err.message} />}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card space-y-2 lg:col-span-1">
          <div className="font-medium">{editId ? 'Kuralı düzenle' : 'Yeni fiyat kuralı'}</div>
          {F('name', 'Kural adı', 'text')}
          <div><label className="label">Kanal hesabı</label><select className="input" value={form.channelAccountId} onChange={(e) => setForm({ ...form, channelAccountId: e.target.value })}><option value="">Tüm kanallar (genel)</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.channel.name} · {a.label}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-2">{F('commissionPercent', 'Komisyon %')}{F('otherCostPercent', 'Diğer gider %')}{F('shippingCost', 'Kargo (₺)')}{F('packagingCost', 'Paketleme (₺)')}{F('targetMarginPercent', 'Hedef net marj %')}<div />{F('minPrice', 'Alt limit (₺)')}{F('maxPrice', 'Üst limit (₺)')}</div>
          <div className="flex gap-2"><button className="btn-primary" disabled={!form.name || save.isPending} onClick={() => save.mutate()}>Kaydet</button>{editId && <button className="btn-secondary" onClick={() => { setEditId(null); setForm(empty); }}>Vazgeç</button>}</div>
          <div className="text-xs text-slate-500">Net marj = (KDV hariç satış − maliyet − komisyon − kargo − paketleme − diğer) / KDV hariç satış. Reklam maliyeti reklam modülü bağlanınca eklenir.</div>
        </section>
        <section className="card lg:col-span-2">
          <div className="mb-2 font-medium">Kurallar</div>
          {rules.data?.length === 0 && <div className="text-sm text-slate-500">Henüz kural yok. Kanal komisyonunu ve hedef marjı girerek başlayın.</div>}
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">{rules.data?.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="font-medium">{r.name}</span><span className="text-slate-500">{r.channelAccount ? `${r.channelAccount.channel.name} · ${r.channelAccount.label}` : 'Genel'}</span>
              <span className="text-xs text-slate-500">kom. %{+r.commissionPercent} · kargo {fmtTRY(+r.shippingCost)} · paket {fmtTRY(+r.packagingCost)} · diğer %{+r.otherCostPercent} · hedef %{+r.targetMarginPercent}{r.minPrice && ` · min ${fmtTRY(+r.minPrice)}`}{r.maxPrice && ` · max ${fmtTRY(+r.maxPrice)}`}</span>
              <span className="ml-auto flex gap-2"><button className="text-xs text-brand-600 underline" onClick={() => { setEditId(r.id); setForm({ name: r.name, channelAccountId: r.channelAccountId ?? '', commissionPercent: r.commissionPercent, shippingCost: r.shippingCost, packagingCost: r.packagingCost, otherCostPercent: r.otherCostPercent, targetMarginPercent: r.targetMarginPercent, minPrice: r.minPrice ?? '', maxPrice: r.maxPrice ?? '' }); }}>Düzenle</button><button className="text-xs text-rose-600 underline" onClick={() => { if (confirm('Kural silinsin mi?')) del.mutate(r.id); }}>Sil</button></span>
            </li>))}</ul>
        </section>
      </div>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-medium">Fiyat önerileri (onay bekleyen)</div>
          <select className="input max-w-xs" value={genAcc} onChange={(e) => setGenAcc(e.target.value)}><option value="">Tüm kanallar</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.channel.name} · {a.label}</option>)}</select>
          <button className="btn-secondary" disabled={gen.isPending} onClick={() => gen.mutate()}>{gen.isPending ? 'Hesaplanıyor…' : 'Önerileri hesapla'}</button>
          {gen.data && <span className="text-sm text-slate-500">{gen.data.created} öneri, {gen.data.skipped} atlandı (kural/maliyet yok veya fark küçük)</span>}
          <span className="ml-auto flex gap-2"><button className="btn-primary" disabled={!sel.length || decide.isPending} onClick={() => { if (confirm(`${sel.length} fiyat değişikliği onaylanacak ve kanala gönderilecek. Devam?`)) decide.mutate({ ids: sel, approve: true }); }}>Seçilenleri onayla ({sel.length})</button><button className="btn-secondary" disabled={!sel.length} onClick={() => decide.mutate({ ids: sel, approve: false })}>Reddet</button></span>
        </div>
        {proposals.data?.length === 0 && <Empty title="Bekleyen öneri yok" hint="Kural tanımlayıp 'Önerileri hesapla' deyin. Hiçbir fiyat onaysız değişmez." />}
        {proposals.data && proposals.data.length > 0 && (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="px-2 py-1"><input type="checkbox" checked={sel.length === proposals.data.length} onChange={(e) => setSel(e.target.checked ? proposals.data!.map((p) => p.id) : [])} /></th><th className="px-2 py-1">Ürün</th><th className="px-2 py-1">Kanal</th><th className="px-2 py-1 text-right">Mevcut</th><th className="px-2 py-1 text-right">Önerilen</th><th className="px-2 py-1 text-right">Net kâr / marj</th><th className="px-2 py-1">Gerekçe</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{proposals.data.map((p) => { const diff = p.currentPrice ? ((+p.proposedPrice - +p.currentPrice) / +p.currentPrice) * 100 : null; return (
              <tr key={p.id}><td className="px-2 py-1"><input type="checkbox" checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} /></td>
                <td className="px-2 py-1">{p.productName ?? '—'}<div className="font-mono text-xs text-slate-500">{p.variantSku}</div></td><td className="px-2 py-1">{p.channelName}<div className="text-xs text-slate-500">{p.accountLabel}</div></td>
                <td className="px-2 py-1 text-right">{p.currentPrice ? fmtTRY(+p.currentPrice) : '—'}</td><td className="px-2 py-1 text-right font-medium">{fmtTRY(+p.proposedPrice)}{diff != null && <Badge tone={diff > 0 ? 'info' : 'warn'}>{diff > 0 ? '+' : ''}{diff.toFixed(1)}%</Badge>}</td>
                <td className="px-2 py-1 text-right">{p.breakdownJson ? `${fmtTRY(p.breakdownJson.netProfit)} · %${p.breakdownJson.marginPercent}` : '—'}</td><td className="px-2 py-1 text-xs text-slate-500">{p.reason}</td></tr>); })}</tbody></table></div>
        )}
      </section>
    </div>
  );
}
