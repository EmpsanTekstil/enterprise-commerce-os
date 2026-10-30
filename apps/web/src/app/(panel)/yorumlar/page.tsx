'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Badge, Empty, ErrorBox } from '@/components/ui';
import { api, getToken } from '@/lib/api';

interface Resp { id: string; source: string; text: string; sentAt: string | null; createdAt: string }
interface Review { id: string; externalId: string; rating: number; title: string | null; text: string | null; customerName: string | null; sentiment: string; aiCategory: string | null; canReplyViaApi: boolean; reviewedAt: string; product: { id: string; name: string } | null; channelAccount: { label: string; channel: { name: string } }; responses: Resp[] }
interface Page { items: Review[]; total: number; summary: { average: number; count: number; distribution: Record<string, number> } }
interface Account { id: string; label: string; channel: { name: string } }
interface Insight { productId: string; product: string; count: number; categories: Record<string, number> }
const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const SENT: Record<string, { l: string; t: 'ok' | 'neutral' | 'bad' | 'warn' }> = { POSITIVE: { l: 'Olumlu', t: 'ok' }, NEUTRAL: { l: 'Nötr', t: 'neutral' }, NEGATIVE: { l: 'Olumsuz', t: 'bad' }, UNKNOWN: { l: 'Sınıflandırılmadı', t: 'warn' } };

export default function ReviewsPage() {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState(''); const [sentiment, setSentiment] = useState(''); const [tab, setTab] = useState<'liste' | 'analiz'>('liste');
  const [open, setOpen] = useState<string | null>(null); const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const accounts = useQuery({ queryKey: ['channel-accounts'], queryFn: () => api<Account[]>('/channels/accounts') });
  const list = useQuery({ queryKey: ['reviews', accountId, sentiment], queryFn: () => api<Page>(`/reviews?pageSize=100${accountId ? `&accountId=${accountId}` : ''}${sentiment ? `&sentiment=${sentiment}` : ''}`) });
  const insights = useQuery({ queryKey: ['review-insights'], queryFn: () => api<Insight[]>('/reviews/insights'), enabled: tab === 'analiz' });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['reviews'] }); qc.invalidateQueries({ queryKey: ['review-insights'] }); };
  const importFile = useMutation({
    mutationFn: async (f: File) => { const fd = new FormData(); fd.append('file', f); const res = await fetch(`${BASE}/api/v1/reviews/import/${accountId}`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: fd }); const b = await res.json(); if (!res.ok) throw new Error(b.message ?? `Hata ${res.status}`); return b as { total: number; created: number; updated: number; errors: { row: number; error: string }[] }; },
    onSuccess: refresh,
  });
  const classify = useMutation({ mutationFn: () => api('/reviews/classify-by-rating', { method: 'POST' }), onSuccess: refresh });
  const analyze = useMutation({ mutationFn: () => api<{ analyzed: number; remaining: number; costUsd: number }>('/reviews/analyze', { method: 'POST', body: JSON.stringify({ limit: 20 }) }), onSuccess: refresh });
  const aiDraft = useMutation({ mutationFn: (id: string) => api(`/reviews/${id}/ai-draft`, { method: 'POST' }), onSuccess: refresh });
  const draft = useMutation({ mutationFn: (p: { id: string; text: string }) => api(`/reviews/${p.id}/draft`, { method: 'POST', body: JSON.stringify({ text: p.text }) }), onSuccess: () => { setOpen(null); setText(''); refresh(); } });
  const send = useMutation({ mutationFn: (p: { id: string; responseId: string; markOnly: boolean }) => api(`/reviews/${p.id}/send`, { method: 'POST', body: JSON.stringify(p) }), onSuccess: refresh });
  const err = (importFile.error ?? analyze.error ?? aiDraft.error ?? draft.error ?? send.error ?? list.error) as Error | null;
  const s = list.data?.summary;

  return (
    <div className="space-y-4">
      <div className="card text-sm text-amber-800 dark:text-amber-300">Türkiye pazaryerlerinin satıcı API'leri yorum okuma/cevaplama sunmuyor (29.10.2026 itibarıyla doğrulandı). Yorumlar, satıcı panelinden indirilen Excel raporuyla içe aktarılır; cevaplar burada hazırlanıp panelden gönderilir.</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <div className="card"><div className="text-xs text-slate-500">Ortalama puan</div><div className="text-2xl font-semibold">{s ? s.average.toFixed(2) : '—'}</div><div className="text-xs text-slate-400">{s?.count ?? 0} yorum</div></div>
        {[5, 4, 3, 2, 1].map((r) => <div key={r} className="card"><div className="text-xs text-slate-500">{r} yıldız</div><div className="text-2xl font-semibold">{s?.distribution[r] ?? 0}</div></div>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={tab === 'liste' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('liste')}>Yorumlar</button>
        <button className={tab === 'analiz' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('analiz')}>Tekrarlayan sorunlar</button>
        <select className="input max-w-xs" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Tüm kanallar</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.channel.name} · {a.label}</option>)}</select>
        <select className="input max-w-[180px]" value={sentiment} onChange={(e) => setSentiment(e.target.value)}><option value="">Tüm duygular</option>{Object.entries(SENT).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</select>
        <button className="btn-secondary" disabled={!accountId || importFile.isPending} onClick={() => input.current?.click()}>{importFile.isPending ? 'Yükleniyor…' : 'Excel ile içe aktar'}</button>
        <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile.mutate(f); e.target.value = ''; }} />
        <button className="btn-secondary" onClick={() => classify.mutate()}>Puana göre sınıflandır</button>
        <button className="btn-secondary" disabled={analyze.isPending} onClick={() => analyze.mutate()}>{analyze.isPending ? 'Analiz ediliyor…' : 'Yapay zekâ ile analiz (20)'}</button>
      </div>
      {!accountId && <div className="text-xs text-slate-500">İçe aktarmak için önce kanal seçin. Sütunlar: Yorum ID, Barkod veya SKU, Puan, Başlık, Yorum, Müşteri, Tarih.</div>}
      {importFile.data && <div className="card text-sm">{importFile.data.created} yeni, {importFile.data.updated} güncellendi{importFile.data.errors.length ? ` · ${importFile.data.errors.length} hatalı satır: ${importFile.data.errors.slice(0, 5).map((e) => `${e.row}: ${e.error}`).join('; ')}` : ''}</div>}
      {analyze.data && <div className="card text-sm">{analyze.data.analyzed} yorum analiz edildi, {analyze.data.remaining} kaldı · maliyet ${analyze.data.costUsd.toFixed(4)}</div>}
      {err && <ErrorBox message={err.message} />}

      {tab === 'analiz' && (
        <div className="card">
          <div className="mb-2 font-medium">Ürün bazında olumsuz yorum kategorileri</div>
          {insights.data?.length === 0 && <div className="text-sm text-slate-500">Olumsuz yorum yok.</div>}
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">{insights.data?.map((i) => <li key={i.productId} className="flex flex-wrap items-center gap-2 py-2"><Link href={`/urunler/${i.productId}`} className="font-medium hover:underline">{i.product}</Link><Badge tone="bad">{i.count} olumsuz</Badge>{Object.entries(i.categories).map(([c, n]) => <Badge key={c} tone="neutral">{c}: {n}</Badge>)}</li>)}</ul>
        </div>
      )}

      {tab === 'liste' && list.data?.items.length === 0 && <Empty title="Yorum yok" hint="Kanal seçip Excel raporunu yükleyin." />}
      {tab === 'liste' && list.data?.items.map((r) => (
        <div key={r.id} className="card space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-amber-500">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
            <Badge tone={SENT[r.sentiment]?.t ?? 'warn'}>{SENT[r.sentiment]?.l}</Badge>
            {r.aiCategory && <span className="text-xs text-slate-500">{r.aiCategory}</span>}
            <span className="text-slate-500">{r.channelAccount.channel.name} · {r.customerName ?? 'Müşteri'} · {new Date(r.reviewedAt).toLocaleDateString('tr-TR')}</span>
            {r.product ? <Link href={`/urunler/${r.product.id}`} className="text-brand-600 underline">{r.product.name}</Link> : <span className="text-xs text-amber-700">Ürün eşleşmedi</span>}
          </div>
          {r.title && <div className="font-medium">{r.title}</div>}
          <p className="whitespace-pre-wrap">{r.text}</p>
          {r.responses.map((x) => (
            <div key={x.id} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/50">
              <div className="flex items-center gap-2 text-xs text-slate-500"><span>{x.source === 'AI_DRAFT' ? 'Yapay zekâ taslağı' : 'Personel'}</span>{x.sentAt ? <Badge tone="ok">Gönderildi</Badge> : <Badge tone="warn">Taslak</Badge>}</div>
              <p className="whitespace-pre-wrap">{x.text}</p>
              {!x.sentAt && <div className="mt-1 flex gap-2">{r.canReplyViaApi ? <button className="btn-primary !py-1" onClick={() => send.mutate({ id: r.id, responseId: x.id, markOnly: false })}>Onayla ve gönder</button> : <button className="btn-secondary !py-1" onClick={() => { navigator.clipboard?.writeText(x.text); if (confirm('Cevap panoya kopyalandı. Panelden gönderdiyseniz işaretlensin mi?')) send.mutate({ id: r.id, responseId: x.id, markOnly: true }); }}>Kopyala · panelden gönderildi</button>}</div>}
            </div>
          ))}
          {open === r.id ? (
            <div className="space-y-1"><textarea className="input min-h-[70px]" value={text} onChange={(e) => setText(e.target.value)} /><div className="flex gap-2"><button className="btn-primary !py-1" disabled={text.trim().length < 5} onClick={() => draft.mutate({ id: r.id, text })}>Taslağı kaydet</button><button className="btn-secondary !py-1" onClick={() => setOpen(null)}>Vazgeç</button></div></div>
          ) : (
            <div className="flex gap-2"><button className="btn-secondary !py-1" onClick={() => { setOpen(r.id); setText(''); }}>Cevap yaz</button><button className="btn-secondary !py-1" disabled={aiDraft.isPending} onClick={() => aiDraft.mutate(r.id)}>Yapay zekâ taslağı</button></div>
          )}
        </div>
      ))}
    </div>
  );
}
