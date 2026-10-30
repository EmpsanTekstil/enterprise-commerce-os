'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Empty, ErrorBox } from '@/components/ui';
import { api, fmtTRY } from '@/lib/api';
import { AdDashboard, pct } from '@/lib/ads';

const ST: Record<string, { l: string; t: 'ok' | 'neutral' | 'warn' | 'info' }> = { ACTIVE: { l: 'Aktif', t: 'ok' }, PAUSED: { l: 'Durduruldu', t: 'neutral' }, ENDED: { l: 'Bitti', t: 'neutral' }, DRAFT: { l: 'Taslak', t: 'warn' }, UNKNOWN: { l: 'Bilinmiyor (içe aktarma)', t: 'info' } };

export default function CampaignsPage() {
  const qc = useQueryClient();
  const [budget, setBudget] = useState<Record<string, string>>({});
  const d = useQuery({ queryKey: ['ads', 30], queryFn: () => api<AdDashboard>('/ads/dashboard') });
  const upd = useMutation({ mutationFn: (p: { id: string; status?: string; dailyBudget?: number }) => api(`/ads/campaigns/${p.id}`, { method: 'POST', body: JSON.stringify({ status: p.status, dailyBudget: p.dailyBudget }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ads'] }) });
  return (
    <div className="space-y-3">
      <div className="card text-sm text-slate-600 dark:text-slate-300">Kampanya oluşturma, durdurma ve bütçe değişikliği yalnızca API'si izin veren kanallarda (bugün: Amazon Ads) ve sizin onayınızla yapılır. Excel ile içe aktarılan kampanyalar salt okunurdur.</div>
      {upd.error && <ErrorBox message={(upd.error as Error).message} />}
      {d.data?.campaigns.length === 0 && <Empty title="Kampanya yok" hint="Reklam Merkezi'nden API ile çekin veya Excel raporu yükleyin." />}
      {d.data && d.data.campaigns.length > 0 && (
        <div className="card overflow-x-auto !p-0"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50"><tr><th className="px-3 py-2">Kampanya</th><th className="px-3 py-2">Kanal</th><th className="px-3 py-2">Durum</th><th className="px-3 py-2 text-right">Günlük bütçe</th><th className="px-3 py-2 text-right">Harcama (30g)</th><th className="px-3 py-2 text-right">Satış</th><th className="px-3 py-2 text-right">ROAS / ACOS</th><th className="px-3 py-2">İşlem</th></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{d.data.campaigns.map((c) => (
            <tr key={c.campaign.id}><td className="px-3 py-2 font-medium">{c.campaign.name}<div className="text-xs font-normal text-slate-500">{c.campaign.source === 'API' ? 'API' : 'Excel içe aktarma'}</div></td><td className="px-3 py-2">{c.campaign.channel}</td><td className="px-3 py-2"><Badge tone={ST[c.campaign.status]?.t ?? 'neutral'}>{ST[c.campaign.status]?.l ?? c.campaign.status}</Badge></td>
              <td className="px-3 py-2 text-right">{c.campaign.isManagedViaApi ? <input className="input w-24 text-right" type="number" min={0} defaultValue={c.campaign.dailyBudget ?? ''} onChange={(e) => setBudget({ ...budget, [c.campaign.id]: e.target.value })} /> : c.campaign.dailyBudget != null ? fmtTRY(c.campaign.dailyBudget) : '—'}</td>
              <td className="px-3 py-2 text-right">{fmtTRY(c.spend)}</td><td className="px-3 py-2 text-right">{fmtTRY(c.sales)}</td><td className="px-3 py-2 text-right">{c.roas.toFixed(2)} / {pct(c.acos)}</td>
              <td className="px-3 py-2">{c.campaign.isManagedViaApi ? (
                <div className="flex gap-1">
                  {budget[c.campaign.id] != null && Number(budget[c.campaign.id]) !== c.campaign.dailyBudget && <button className="btn-primary !py-1 text-xs" disabled={upd.isPending} onClick={() => { if (confirm(`Günlük bütçe ${budget[c.campaign.id]} ₺ olarak kanala gönderilecek. Onaylıyor musunuz?`)) upd.mutate({ id: c.campaign.id, dailyBudget: Number(budget[c.campaign.id]) }); }}>Bütçeyi kaydet</button>}
                  {c.campaign.status === 'ACTIVE' ? <button className="btn-secondary !py-1 text-xs" disabled={upd.isPending} onClick={() => { if (confirm('Kampanya durdurulsun mu?')) upd.mutate({ id: c.campaign.id, status: 'PAUSED' }); }}>Durdur</button> : <button className="btn-secondary !py-1 text-xs" disabled={upd.isPending} onClick={() => { if (confirm('Kampanya başlatılsın mı?')) upd.mutate({ id: c.campaign.id, status: 'ACTIVE' }); }}>Başlat</button>}
                </div>) : <span className="text-xs text-slate-400">Panelden yönetilir</span>}</td></tr>))}</tbody></table></div>
      )}
    </div>
  );
}
