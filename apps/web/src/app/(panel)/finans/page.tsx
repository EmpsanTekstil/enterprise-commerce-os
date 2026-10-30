'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorBox, StatCard } from '@/components/ui';
import { api, fmtNum, fmtTRY, getToken } from '@/lib/api';

interface Summary { totals: { revenue: number; orders: number; commission: number; productCost: number; adSpend: number; adSales: number; aiCostUsd: number; grossProfit: number; avgBasket: number }; series: { day: string; revenue: number; orders: number }[]; channels: { accountId: string; channel: string; label: string; revenue: number; orders: number; avgBasket: number; commission: number; returnRate: number; cancelRate: number }[]; topProducts: { productId: string | null; name: string; sku: string | null; qty: number; revenue: number; grossProfit: number; hasCost: boolean }[]; mostProfitable: Summary['topProducts']; leastProfitable: Summary['topProducts'] }
const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function FinancePage() {
  const [days, setDays] = useState(30);
  const from = new Date(Date.now() - (days - 1) * 86_400_000); from.setHours(0, 0, 0, 0);
  const q = useQuery({ queryKey: ['finance', days], queryFn: () => api<Summary>(`/finance/summary?from=${from.toISOString()}`) });
  const exportXlsx = async () => { const res = await fetch(`${BASE}/api/v1/finance/export?from=${from.toISOString()}`, { headers: { Authorization: `Bearer ${getToken()}` } }); const b = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `rapor-${days}gun.xlsx`; a.click(); };
  if (q.error) return <ErrorBox message={(q.error as Error).message} />;
  const t = q.data?.totals; const max = Math.max(1, ...(q.data?.series.map((s) => s.revenue) ?? [1]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">{[7, 30, 90].map((d) => <button key={d} className={days === d ? 'btn-primary' : 'btn-secondary'} onClick={() => setDays(d)}>Son {d} gün</button>)}<button className="btn-secondary ml-auto" onClick={exportXlsx}>Excel indir</button></div>
      {t && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Ciro" value={fmtTRY(t.revenue)} hint={`${fmtNum(t.orders)} sipariş · ort. ${fmtTRY(t.avgBasket)}`} />
            <StatCard label="Komisyon" value={fmtTRY(t.commission)} />
            <StatCard label="Ürün maliyeti" value={fmtTRY(t.productCost)} hint="Maliyeti girilmiş ürünler" />
            <StatCard label="Brüt kâr" value={fmtTRY(t.grossProfit)} hint="Ciro − komisyon − maliyet − reklam" tone={t.grossProfit >= 0 ? 'ok' : 'bad'} />
            <StatCard label="Reklam harcaması" value={fmtTRY(t.adSpend)} hint={`Reklam satışı ${fmtTRY(t.adSales)}`} />
            <StatCard label="Yapay zekâ maliyeti" value={`$${t.aiCostUsd.toFixed(2)}`} />
          </div>
          <section className="card"><div className="mb-2 font-medium">Günlük ciro</div>
            <div className="flex h-40 items-end gap-[2px]">{q.data!.series.map((s) => <div key={s.day} title={`${s.day}: ${fmtTRY(s.revenue)} · ${s.orders} sipariş`} className="flex-1 rounded-t bg-brand-500/80" style={{ height: `${(s.revenue / max) * 100}%` }} />)}</div>
            {q.data!.series.length === 0 && <div className="text-sm text-slate-500">Bu aralıkta sipariş yok.</div>}
          </section>
          <section className="card overflow-x-auto !p-0"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50"><tr><th className="px-3 py-2">Kanal</th><th className="px-3 py-2 text-right">Ciro</th><th className="px-3 py-2 text-right">Sipariş</th><th className="px-3 py-2 text-right">Ort. sepet</th><th className="px-3 py-2 text-right">Komisyon</th><th className="px-3 py-2 text-right">İptal %</th><th className="px-3 py-2 text-right">İade %</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{q.data!.channels.map((c) => <tr key={c.accountId}><td className="px-3 py-2">{c.channel}<div className="text-xs text-slate-500">{c.label}</div></td><td className="px-3 py-2 text-right">{fmtTRY(c.revenue)}</td><td className="px-3 py-2 text-right">{c.orders}</td><td className="px-3 py-2 text-right">{fmtTRY(c.avgBasket)}</td><td className="px-3 py-2 text-right">{fmtTRY(c.commission)}</td><td className="px-3 py-2 text-right">{c.cancelRate.toFixed(1)}</td><td className="px-3 py-2 text-right">{c.returnRate.toFixed(1)}</td></tr>)}</tbody></table></section>
          <div className="grid gap-4 lg:grid-cols-3">
            {[['En çok satan', q.data!.topProducts], ['En kârlı', q.data!.mostProfitable], ['En az kârlı', q.data!.leastProfitable]].map(([title, rows]) => (
              <section key={title as string} className="card"><div className="mb-2 font-medium">{title as string}</div>
                <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">{(rows as Summary['topProducts']).map((p, i) => <li key={`${p.sku}-${i}`} className="flex items-center gap-2 py-1.5"><span className="truncate">{p.name}</span><span className="ml-auto whitespace-nowrap text-xs text-slate-500">{p.qty} ad.</span><span className="whitespace-nowrap">{fmtTRY(title === 'En çok satan' ? p.revenue : p.grossProfit)}</span></li>)}{(rows as unknown[]).length === 0 && <li className="text-sm text-slate-500">Veri yok{title !== 'En çok satan' ? ' (ürün maliyeti girilmeli)' : ''}</li>}</ul>
              </section>))}
          </div>
        </>
      )}
    </div>
  );
}
