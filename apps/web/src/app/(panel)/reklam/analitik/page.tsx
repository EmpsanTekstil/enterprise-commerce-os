'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, ErrorBox } from '@/components/ui';
import { api } from '@/lib/api';

interface Finding { campaignId: string; campaign: string; channel: string; severity: 'high' | 'medium' | 'low'; issue: string; suggestion: string }
const SEV: Record<string, { l: string; t: 'bad' | 'warn' | 'ok' }> = { high: { l: 'Yüksek', t: 'bad' }, medium: { l: 'Orta', t: 'warn' }, low: { l: 'Fırsat', t: 'ok' } };

export default function AdsAnalyticsPage() {
  const [target, setTarget] = useState(25); const [days, setDays] = useState(30);
  const from = new Date(Date.now() - (days - 1) * 86_400_000); from.setHours(0, 0, 0, 0);
  const a = useQuery({ queryKey: ['ads-analysis', target, days], queryFn: () => api<{ findings: Finding[] }>(`/ads/analysis?targetAcos=${target}&from=${from.toISOString()}`) });
  const ai = useMutation({ mutationFn: () => api<{ text: string; costUsd: number }>('/ads/ai-analysis', { method: 'POST', body: JSON.stringify({ targetAcos: target, from: from.toISOString() }) }) });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((x) => <button key={x} className={days === x ? 'btn-primary' : 'btn-secondary'} onClick={() => setDays(x)}>Son {x} gün</button>)}
        <label className="flex items-center gap-2 text-sm">Hedef ACOS %<input className="input w-20" type="number" min={1} max={100} value={target} onChange={(e) => setTarget(Number(e.target.value) || 25)} /></label>
        <button className="btn-secondary ml-auto" disabled={ai.isPending} onClick={() => ai.mutate()}>{ai.isPending ? 'Analiz ediliyor…' : 'Yapay zekâ yorumu'}</button>
      </div>
      {(a.error ?? ai.error) && <ErrorBox message={((a.error ?? ai.error) as Error).message} />}
      <section className="card">
        <div className="mb-2 font-medium">Kural tabanlı bulgular</div>
        {a.data?.findings.length === 0 && <div className="text-sm text-slate-500">Bulgu yok (veri yetersiz veya her şey hedefte).</div>}
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">{a.data?.findings.map((f, i) => <li key={i} className="flex flex-wrap items-start gap-2 py-2"><Badge tone={SEV[f.severity].t}>{SEV[f.severity].l}</Badge><span className="font-medium">{f.campaign}</span><span className="text-slate-500">{f.channel}</span><span>{f.issue}</span><span className="w-full text-slate-600 dark:text-slate-300">→ {f.suggestion}</span></li>)}</ul>
      </section>
      {ai.data && <section className="card space-y-1 text-sm"><div className="flex items-center gap-2"><div className="font-medium">Yapay zekâ yorumu</div><span className="text-xs text-slate-500">maliyet ${ai.data.costUsd.toFixed(4)}</span></div><p className="whitespace-pre-wrap">{ai.data.text}</p><div className="text-xs text-slate-500">Öneriler bilgilendirme amaçlıdır; hiçbir bütçe onayınız olmadan değişmez.</div></section>}
    </div>
  );
}
