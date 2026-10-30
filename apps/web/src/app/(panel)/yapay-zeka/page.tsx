'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, ErrorBox } from '@/components/ui';
import { api } from '@/lib/api';

interface Status { enabled: boolean; model: string; totalCostUsd: number; byFeature: { feature: string; count: number; inputTokens: number; outputTokens: number; costUsd: number }[] }
interface Hist { id: string; feature: string; model: string; inputTokens: number; outputTokens: number; costUsd: string; status: string; error: string | null; createdAt: string; user: { fullName: string } | null }
interface Content { title: string | null; description: string; seoKeywords: string[]; missingInfo: string[]; costUsd: number; note?: string }
interface DQ { checked: number; withIssues: number; items: { productId: string; name: string; problems: string[] }[] }
interface Product { id: string; name: string }
const FEAT: Record<string, string> = { question_draft: 'Soru cevap taslağı', review_analyze: 'Yorum analizi', review_reply: 'Yorum cevap taslağı', product_content: 'Ürün içeriği', ads_analyze: 'Reklam analizi' };

export default function AiStudioPage() {
  const [tab, setTab] = useState<'icerik' | 'kalite' | 'kullanim'>('icerik');
  const [q, setQ] = useState(''); const [productId, setProductId] = useState(''); const [channel, setChannel] = useState('Trendyol');
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api<Status>('/ai/status?days=30') });
  const history = useQuery({ queryKey: ['ai-history'], queryFn: () => api<Hist[]>('/ai/history'), enabled: tab === 'kullanim' });
  const products = useQuery({ queryKey: ['products-pick', q], queryFn: () => api<{ items: Product[] }>(`/products?pageSize=20&q=${encodeURIComponent(q)}`), enabled: tab === 'icerik' });
  const dq = useQuery({ queryKey: ['data-quality'], queryFn: () => api<DQ>('/ai/data-quality'), enabled: tab === 'kalite' });
  const gen = useMutation({ mutationFn: () => api<Content>(`/ai/products/${productId}/content`, { method: 'POST', body: JSON.stringify({ channel }) }) });
  const apply = useMutation({ mutationFn: (p: { title?: string; description?: string }) => api(`/ai/products/${productId}/content/apply`, { method: 'POST', body: JSON.stringify(p) }) });

  return (
    <div className="space-y-4">
      <div className={`card text-sm ${status.data?.enabled ? '' : 'border-amber-300'}`}>
        {status.data?.enabled ? <>Yapay zekâ açık · model <code>{status.data.model}</code> · son 30 gün maliyeti <b>${status.data.totalCostUsd.toFixed(4)}</b></> : <>Yapay zekâ kapalı. Açmak için sunucuda <code>.env</code> dosyasına <code>ANTHROPIC_API_KEY</code> ekleyin ve API'yi yeniden başlatın. Bu ekran anahtar olmadan sahte çıktı üretmez.</>}
      </div>
      <div className="flex gap-2">{([['icerik', 'Ürün içeriği'], ['kalite', 'Veri kalitesi'], ['kullanim', 'Kullanım ve maliyet']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === 'icerik' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card space-y-2">
            <div className="font-medium">Başlık ve açıklama önerisi</div>
            <input className="input" placeholder="Ürün ara" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Ürün seçin</option>{products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>{['Trendyol', 'Hepsiburada', 'Amazon', 'n11', 'idefix', 'Shopify (kendi site)'].map((c) => <option key={c}>{c}</option>)}</select>
            <button className="btn-primary" disabled={!productId || gen.isPending} onClick={() => gen.mutate()}>{gen.isPending ? 'Üretiliyor…' : 'Öneri üret'}</button>
            <div className="text-xs text-slate-500">Model yalnızca ürün kartındaki bilgileri kullanır; eksik bilgileri ayrıca listeler. Hiçbir şey onaysız kaydedilmez.</div>
            {gen.error && <ErrorBox message={(gen.error as Error).message} />}
          </section>
          {gen.data && (
            <section className="card space-y-2 text-sm">
              <div className="flex items-center gap-2"><div className="font-medium">Öneri</div><span className="text-xs text-slate-500">maliyet ${gen.data.costUsd.toFixed(4)}</span></div>
              {gen.data.note && <div className="text-xs text-amber-700">{gen.data.note}</div>}
              {gen.data.title && <div><div className="label">Başlık ({gen.data.title.length}/100)</div><div className="rounded bg-slate-50 p-2 dark:bg-slate-800/50">{gen.data.title}</div></div>}
              <div><div className="label">Açıklama</div><div className="whitespace-pre-wrap rounded bg-slate-50 p-2 dark:bg-slate-800/50">{gen.data.description}</div></div>
              {gen.data.seoKeywords?.length > 0 && <div className="flex flex-wrap gap-1">{gen.data.seoKeywords.map((k) => <Badge key={k} tone="info">{k}</Badge>)}</div>}
              {gen.data.missingInfo?.length > 0 && <div className="text-xs text-amber-700">Eksik bilgiler: {gen.data.missingInfo.join(', ')}</div>}
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={apply.isPending} onClick={() => { if (confirm('Merkezi ürünün adı ve açıklaması bu öneriyle değiştirilecek. Onaylıyor musunuz?')) apply.mutate({ title: gen.data!.title ?? undefined, description: gen.data!.description }); }}>Ürüne uygula</button>
                <button className="btn-secondary" onClick={() => navigator.clipboard?.writeText(`${gen.data!.title ?? ''}\n\n${gen.data!.description}`)}>Kopyala</button>
                <Link href={`/urunler/${productId}`} className="btn-secondary">Ürüne git</Link>
              </div>
              {apply.isSuccess && <div className="text-emerald-600">Uygulandı.</div>}
            </section>
          )}
        </div>
      )}

      {tab === 'kalite' && (
        <section className="card space-y-2 text-sm">
          <div className="font-medium">Veri kalitesi kontrolü {dq.data && <span className="text-slate-500">· {dq.data.checked} ürün, {dq.data.withIssues} sorunlu</span>}</div>
          <div className="text-xs text-slate-500">Kural tabanlıdır, yapay zekâ gerektirmez. Eksikler yayınlamayı ve kârlılık hesabını engeller.</div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">{dq.data?.items.map((i) => <li key={i.productId} className="py-2"><Link href={`/urunler/${i.productId}`} className="font-medium hover:underline">{i.name}</Link><div className="flex flex-wrap gap-1 pt-1">{i.problems.map((p) => <Badge key={p} tone="warn">{p}</Badge>)}</div></li>)}</ul>
        </section>
      )}

      {tab === 'kullanim' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{status.data?.byFeature.map((f) => <div key={f.feature} className="card"><div className="text-xs text-slate-500">{FEAT[f.feature] ?? f.feature}</div><div className="text-xl font-semibold">${f.costUsd.toFixed(4)}</div><div className="text-xs text-slate-400">{f.count} çağrı · {f.inputTokens + f.outputTokens} token</div></div>)}</div>
          <div className="card overflow-x-auto !p-0"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50"><tr><th className="px-3 py-2">Zaman</th><th className="px-3 py-2">İşlev</th><th className="px-3 py-2">Kullanıcı</th><th className="px-3 py-2 text-right">Token</th><th className="px-3 py-2 text-right">Maliyet</th><th className="px-3 py-2">Durum</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{history.data?.map((h) => <tr key={h.id}><td className="px-3 py-2 text-xs">{new Date(h.createdAt).toLocaleString('tr-TR')}</td><td className="px-3 py-2">{FEAT[h.feature] ?? h.feature}</td><td className="px-3 py-2">{h.user?.fullName ?? '—'}</td><td className="px-3 py-2 text-right">{h.inputTokens + h.outputTokens}</td><td className="px-3 py-2 text-right">${Number(h.costUsd).toFixed(5)}</td><td className="px-3 py-2">{h.status === 'SUCCESS' ? <Badge tone="ok">Başarılı</Badge> : <span title={h.error ?? ''}><Badge tone="bad">Başarısız</Badge></span>}</td></tr>)}</tbody></table></div>
        </div>
      )}
    </div>
  );
}
