'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { Badge, ErrorBox } from '@/components/ui';
import { api, fmtTRY } from '@/lib/api';

interface Product {
  id: string; name: string; brand: string | null; model: string | null; status: string; description: string | null; shortDescription: string | null;
  specsJson: Record<string, string>; vatRate: string; packageContent: string | null; warrantyMonths: number | null; originCountry: string | null;
  category: { name: string; path: string } | null; images: { id: string; url: string }[];
  variants: { id: string; sku: string; barcode: string | null; color: string | null; size: string | null; costPrice: string | null; listPrice: string | null; balances: { onHand: number; reserved: number; warehouse: { name: string } }[]; listings: { id: string; status: string; channelAccount: { label: string; channel: { name: string } } }[] }[];
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['product', id], queryFn: () => api<Product>(`/products/${id}`) });
  const r = useQuery({ queryKey: ['readiness', id], queryFn: () => api<{ ready: boolean; missing: string[] }>(`/products/${id}/readiness`) });
  if (q.error) return <ErrorBox message={(q.error as Error).message} />;
  if (!q.data) return <div className="text-sm text-slate-500">Yükleniyor…</div>;
  const p = q.data;
  const margin = (v: Product['variants'][number]) => {
    const cost = Number(v.costPrice ?? 0), price = Number(v.listPrice ?? 0);
    if (!cost || !price) return null;
    const net = price / (1 + Number(p.vatRate) / 100);
    return Math.round(((net - cost) / net) * 100);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div><h2 className="text-xl font-semibold">{p.name}</h2><div className="text-sm text-slate-500">{[p.brand, p.model, p.category?.path].filter(Boolean).join(' · ') || '—'}</div></div>
        <div className="ml-auto"><Badge tone={p.status === 'ACTIVE' ? 'ok' : 'warn'}>{p.status === 'ACTIVE' ? 'Aktif' : p.status === 'DRAFT' ? 'Taslak' : 'Arşiv'}</Badge></div>
      </div>

      {r.data && (
        <div className={`card ${r.data.ready ? 'border-emerald-300' : 'border-amber-300'}`}>
          <div className="font-medium">{r.data.ready ? 'Yayına hazır' : 'Yayın öncesi eksikler'}</div>
          {!r.data.ready && <ul className="mt-1 list-disc pl-5 text-sm text-slate-600 dark:text-slate-300">{r.data.missing.map((m) => <li key={m}>{m}</li>)}</ul>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2 space-y-2 text-sm">
          <div className="font-medium">Açıklama</div>
          <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{p.description || 'Açıklama girilmemiş.'}</p>
          {Object.keys(p.specsJson ?? {}).length > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">{Object.entries(p.specsJson).map(([k, v]) => <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd>{v}</dd></div>)}</dl>
          )}
        </section>
        <section className="card text-sm space-y-1">
          <div className="font-medium">Bilgiler</div>
          <div>KDV: %{p.vatRate}</div><div>Garanti: {p.warrantyMonths ?? '—'} ay</div><div>Menşei: {p.originCountry ?? '—'}</div><div>Paket içeriği: {p.packageContent ?? '—'}</div>
          <div>Görsel: {p.images.length} adet</div>
        </section>
      </div>

      <section className="card overflow-x-auto !p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50"><tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Barkod</th><th className="px-3 py-2">Renk / Beden</th><th className="px-3 py-2 text-right">Maliyet</th><th className="px-3 py-2 text-right">Satış</th><th className="px-3 py-2 text-right">Brüt marj</th><th className="px-3 py-2 text-right">Stok</th><th className="px-3 py-2">Yayınlar</th></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {p.variants.map((v) => {
              const mg = margin(v);
              return (
                <tr key={v.id}>
                  <td className="px-3 py-2 font-mono text-xs">{v.sku}</td><td className="px-3 py-2 font-mono text-xs">{v.barcode ?? '—'}</td>
                  <td className="px-3 py-2">{[v.color, v.size].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="px-3 py-2 text-right">{v.costPrice ? fmtTRY(Number(v.costPrice)) : '—'}</td><td className="px-3 py-2 text-right">{v.listPrice ? fmtTRY(Number(v.listPrice)) : '—'}</td>
                  <td className={`px-3 py-2 text-right ${mg != null && mg < 10 ? 'text-rose-600' : ''}`}>{mg == null ? '—' : `%${mg}`}</td>
                  <td className="px-3 py-2 text-right">{v.balances.reduce((s, b) => s + b.onHand - b.reserved, 0)}</td>
                  <td className="px-3 py-2">{v.listings.length === 0 ? <span className="text-slate-400">—</span> : v.listings.map((l) => <Badge key={l.id} tone={l.status === 'ACTIVE' ? 'ok' : 'neutral'}>{l.channelAccount.channel.name}</Badge>)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <div className="text-xs text-slate-500">Brüt marj = (KDV hariç satış − maliyet) / KDV hariç satış. Komisyon, kargo ve reklam maliyeti Fiyat Yönetimi modülünde (Faz 6) hesaba katılacak.</div>
    </div>
  );
}
