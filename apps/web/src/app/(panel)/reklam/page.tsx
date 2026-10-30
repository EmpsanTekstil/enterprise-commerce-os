'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Badge, ErrorBox, StatCard } from '@/components/ui';
import { api, fmtNum, fmtTRY, getToken } from '@/lib/api';
import { AdDashboard, pct } from '@/lib/ads';

interface Account { id: string; label: string; status: string; channel: { code: string; name: string } }
interface Channel { code: string; capabilities: Record<string, { status: string }> | null }
const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function AdsCenterPage() {
  const qc = useQueryClient();
  const [days, setDays] = useState(30); const [accountId, setAccountId] = useState('');
  const from = new Date(Date.now() - (days - 1) * 86_400_000); from.setHours(0, 0, 0, 0);
  const d = useQuery({ queryKey: ['ads', days], queryFn: () => api<AdDashboard>(`/ads/dashboard?from=${from.toISOString()}`) });
  const accounts = useQuery({ queryKey: ['channel-accounts'], queryFn: () => api<Account[]>('/channels/accounts') });
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api<Channel[]>('/channels') });
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['ads'] });
  const pull = useMutation({ mutationFn: (id: string) => api<{ status?: string; error?: string }>(`/sync/accounts/${id}/run`, { method: 'POST', body: JSON.stringify({ type: 'ADS_PULL' }) }), onSuccess: refresh });
  const importFile = useMutation({ mutationFn: async (f: File) => { const fd = new FormData(); fd.append('file', f); const res = await fetch(`${BASE}/api/v1/ads/import/${accountId}`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: fd }); const b = await res.json(); if (!res.ok) throw new Error(b.message ?? `Hata ${res.status}`); return b as { total: number; saved: number; errors: { row: number; error: string }[] }; }, onSuccess: refresh });
  const apiSupported = (code: string) => channels.data?.find((c) => c.code === code)?.capabilities?.['ads.reports']?.status === 'supported';
  const acc = accounts.data?.find((a) => a.id === accountId);
  const t = d.data?.total; const max = Math.max(1, ...(d.data?.series.map((s) => Math.max(s.spend, s.sales)) ?? [1]));
  const err = (pull.error ?? importFile.error ?? d.error) as Error | null;
  return (
    <div className="space-y-4">
      <div className="card text-sm text-amber-800 dark:text-amber-300">Trendyol, Hepsiburada, n11 ve idefix reklam verisine satıcı API'si vermiyor (doğrulama: 29.10.2026). Bu kanallar için reklam panelinden indirilen raporu Excel ile içe aktarın; Amazon Ads API bağlandığında otomatik çekilir. Bütçe değişikliği yalnızca API destekleyen kanallarda ve sizin onayınızla yapılır.</div>
      <div className="flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((x) => <button key={x} className={days === x ? 'btn-primary' : 'btn-secondary'} onClick={() => setDays(x)}>Son {x} gün</button>)}
        <select className="input max-w-xs" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Kanal hesabı seçin</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.channel.name} · {a.label}</option>)}</select>
        {acc && (apiSupported(acc.channel.code) ? <button className="btn-secondary" disabled={pull.isPending} onClick={() => pull.mutate(acc.id)}>API'den çek</button> : <><button className="btn-secondary" disabled={importFile.isPending} onClick={() => input.current?.click()}>{importFile.isPending ? 'Yükleniyor…' : 'Excel raporu içe aktar'}</button><span className="text-xs text-slate-500">Sütunlar: Tarih, Kampanya, Barkod, Gösterim, Tıklama, Harcama, Sipariş, Satış Tutarı, Günlük Bütçe</span></>)}
        <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile.mutate(f); e.target.value = ''; }} />
        <Link href="/reklam/kampanyalar" className="btn-secondary ml-auto">Kampanyalar</Link><Link href="/reklam/analitik" className="btn-secondary">Analitik</Link>
      </div>
      {importFile.data && <div className="card text-sm">{importFile.data.saved} satır işlendi{importFile.data.errors.length ? ` · hatalı: ${importFile.data.errors.map((e) => `${e.row}: ${e.error}`).join('; ')}` : ''}</div>}
      {pull.data?.status === 'FAILED' && <ErrorBox message={pull.data.error ?? 'Çekme başarısız'} />}
      {err && <ErrorBox message={err.message} />}
      {t && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <StatCard label="Harcama" value={fmtTRY(t.spend)} /><StatCard label="Reklam satışı" value={fmtTRY(t.sales)} hint={`${t.orders} sipariş`} />
            <StatCard label="ROAS" value={t.roas.toFixed(2)} tone={t.roas >= 3 ? 'ok' : t.roas >= 1.5 ? 'warn' : 'bad'} /><StatCard label="ACOS" value={pct(t.acos)} />
            <StatCard label="Gösterim / Tıklama" value={`${fmtNum(t.impressions)} / ${fmtNum(t.clicks)}`} hint={`CTR ${pct(t.ctr, 2)} · CPC ${fmtTRY(t.cpc)}`} />
            <StatCard label="Aktif kampanya" value={`${d.data!.activeCampaigns} / ${d.data!.totalCampaigns}`} />
          </div>
          <section className="card"><div className="mb-2 font-medium">Günlük harcama (koyu) ve reklam satışı (açık)</div>
            <div className="flex h-40 items-end gap-[2px]">{d.data!.series.map((s) => <div key={s.day} className="flex flex-1 items-end gap-px" title={`${s.day}: harcama ${fmtTRY(s.spend)} · satış ${fmtTRY(s.sales)}`}><div className="flex-1 rounded-t bg-brand-700" style={{ height: `${(s.spend / max) * 100}%` }} /><div className="flex-1 rounded-t bg-brand-300" style={{ height: `${(s.sales / max) * 100}%` }} /></div>)}</div>
            {d.data!.series.length === 0 && <div className="text-sm text-slate-500">Bu aralıkta reklam verisi yok.</div>}
          </section>
          <section className="card overflow-x-auto !p-0"><div className="px-3 pt-3 font-medium">Pazaryeri karşılaştırması</div><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Kanal</th><th className="px-3 py-2 text-right">Harcama</th><th className="px-3 py-2 text-right">Satış</th><th className="px-3 py-2 text-right">ROAS</th><th className="px-3 py-2 text-right">ACOS</th><th className="px-3 py-2 text-right">CTR</th><th className="px-3 py-2 text-right">CPC</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{d.data!.channels.map((c) => <tr key={c.accountId}><td className="px-3 py-2">{c.channel}<div className="text-xs text-slate-500">{c.label}</div></td><td className="px-3 py-2 text-right">{fmtTRY(c.spend)}</td><td className="px-3 py-2 text-right">{fmtTRY(c.sales)}</td><td className="px-3 py-2 text-right">{c.roas.toFixed(2)}</td><td className="px-3 py-2 text-right">{pct(c.acos)}</td><td className="px-3 py-2 text-right">{pct(c.ctr, 2)}</td><td className="px-3 py-2 text-right">{fmtTRY(c.cpc)}</td></tr>)}</tbody></table></section>
          <section className="card overflow-x-auto !p-0"><div className="px-3 pt-3 font-medium">Ürün bazında reklam performansı</div><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Ürün</th><th className="px-3 py-2 text-right">Harcama</th><th className="px-3 py-2 text-right">Satış</th><th className="px-3 py-2 text-right">Sipariş</th><th className="px-3 py-2 text-right">ROAS</th><th className="px-3 py-2 text-right">ACOS</th><th className="px-3 py-2 text-right">Dönüşüm</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{d.data!.products.map((p) => <tr key={p.variantId}><td className="px-3 py-2">{p.name}<div className="font-mono text-xs text-slate-500">{p.sku}</div></td><td className="px-3 py-2 text-right">{fmtTRY(p.spend)}</td><td className="px-3 py-2 text-right">{fmtTRY(p.sales)}</td><td className="px-3 py-2 text-right">{p.orders}</td><td className="px-3 py-2 text-right">{p.roas.toFixed(2)}</td><td className="px-3 py-2 text-right">{pct(p.acos)}</td><td className="px-3 py-2 text-right">{pct(p.conversion)}</td></tr>)}{d.data!.products.length === 0 && <tr><td className="px-3 py-3 text-slate-500" colSpan={7}>Ürün bazında veri için raporda barkod sütunu olmalı.</td></tr>}</tbody></table></section>
        </>
      )}
    </div>
  );
}
