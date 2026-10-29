'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Empty, ErrorBox } from '@/components/ui';
import { api, fmtTRY } from '@/lib/api';

interface Row { id: string; name: string; brand: string | null; status: string; isDemo: boolean; totalStock: number; listingCount: number; variants: { sku: string; listPrice: string | null }[]; category: { name: string } | null }
interface Page { items: Row[]; total: number; page: number; pageCount: number }

const STATUS: Record<string, { l: string; t: 'ok' | 'warn' | 'neutral' }> = { ACTIVE: { l: 'Aktif', t: 'ok' }, DRAFT: { l: 'Taslak', t: 'warn' }, ARCHIVED: { l: 'Arşiv', t: 'neutral' } };

export default function ProductsPage() {
  const [q, setQ] = useState(''); const [page, setPage] = useState(1); const [status, setStatus] = useState('');
  const { data, error, isLoading } = useQuery({
    queryKey: ['products', q, page, status],
    queryFn: () => api<Page>(`/products?page=${page}&pageSize=25&q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}`),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Ürün adı, marka, SKU veya barkod ara" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="input max-w-[160px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Tüm durumlar</option><option value="ACTIVE">Aktif</option><option value="DRAFT">Taslak</option><option value="ARCHIVED">Arşiv</option>
        </select>
        <Link href="/urunler/yeni" className="btn-primary ml-auto">Yeni Ürün</Link>
      </div>
      {error && <ErrorBox message={(error as Error).message} />}
      {isLoading && <div className="text-sm text-slate-500">Yükleniyor…</div>}
      {data && data.items.length === 0 && <Empty title="Ürün bulunamadı" hint="İlk ürününüzü 'Yeni Ürün' ile oluşturun veya pazaryerinden içe aktarın." />}
      {data && data.items.length > 0 && (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50">
              <tr><th className="px-3 py-2">Ürün</th><th className="px-3 py-2">Marka</th><th className="px-3 py-2">Varyant</th><th className="px-3 py-2 text-right">Fiyat</th><th className="px-3 py-2 text-right">Stok</th><th className="px-3 py-2">Yayın</th><th className="px-3 py-2">Durum</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.items.map((p) => {
                const prices = p.variants.map((v) => Number(v.listPrice ?? 0)).filter(Boolean);
                return (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-2"><Link href={`/urunler/${p.id}`} className="font-medium hover:underline">{p.name}</Link>{p.isDemo && <span className="ml-2 text-[10px] text-slate-400">DEMO</span>}<div className="text-xs text-slate-500">{p.category?.name ?? '—'}</div></td>
                    <td className="px-3 py-2">{p.brand ?? '—'}</td>
                    <td className="px-3 py-2">{p.variants.length}</td>
                    <td className="px-3 py-2 text-right">{prices.length ? (prices.length > 1 ? `${fmtTRY(Math.min(...prices))} – ${fmtTRY(Math.max(...prices))}` : fmtTRY(prices[0])) : '—'}</td>
                    <td className="px-3 py-2 text-right">{p.totalStock}</td>
                    <td className="px-3 py-2">{p.listingCount} kanal</td>
                    <td className="px-3 py-2"><Badge tone={STATUS[p.status]?.t ?? 'neutral'}>{STATUS[p.status]?.l ?? p.status}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && data.pageCount > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Önceki</button>
          <span>Sayfa {data.page} / {data.pageCount} · {data.total} ürün</span>
          <button className="btn-secondary" disabled={page >= data.pageCount} onClick={() => setPage(page + 1)}>Sonraki</button>
        </div>
      )}
    </div>
  );
}
