'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Empty, ErrorBox } from '@/components/ui';
import { api, fmtTRY } from '@/lib/api';
import { ORDER_STATUS } from '@/lib/status';

interface Order { id: string; orderNumber: string | null; externalId: string; status: string; channelStatus: string | null; customerName: string | null; grandTotal: string; orderedAt: string; isDemo: boolean; channelAccount: { label: string; channel: { name: string } }; items: { id: string; name: string; quantity: number; variantId: string | null }[]; shipments: { carrierName: string | null; trackingNumber: string | null; status: string }[] }
interface Page { items: Order[]; total: number; page: number; pageCount: number }


export default function OrdersPage() {
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1);
  const { data, error, isLoading } = useQuery({
    queryKey: ['orders', q, status, page],
    queryFn: () => api<Page>(`/orders?page=${page}&pageSize=50&q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}`),
    refetchInterval: 30_000,
  });
  const exportCsv = () => {
    if (!data) return;
    const rows = [['Kanal', 'Hesap', 'Sipariş No', 'Durum', 'Müşteri', 'Tutar', 'Tarih', 'Kalem'].join(';')];
    for (const o of data.items) rows.push([o.channelAccount.channel.name, o.channelAccount.label, o.orderNumber ?? o.externalId, ORDER_STATUS[o.status]?.l ?? o.status, o.customerName ?? '', String(o.grandTotal).replace('.', ','), new Date(o.orderedAt).toLocaleString('tr-TR'), o.items.map((i) => `${i.quantity}x ${i.name}`).join(' | ')].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'));
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'siparisler.csv'; a.click();
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Sipariş no, müşteri ara" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="input max-w-[170px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Tüm durumlar</option>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
        </select>
        <button className="btn-secondary ml-auto" onClick={exportCsv} disabled={!data?.items.length}>Excel/CSV indir</button>
      </div>
      {error && <ErrorBox message={(error as Error).message} />}
      {isLoading && <div className="text-sm text-slate-500">Yükleniyor…</div>}
      {data?.items.length === 0 && <Empty title="Sipariş yok" hint="Pazaryeri Yayınları sayfasından 'Siparişleri çek' ile veya otomatik senkron ile gelir." />}
      {data && data.items.length > 0 && (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50"><tr><th className="px-3 py-2">Sipariş</th><th className="px-3 py-2">Kanal</th><th className="px-3 py-2">Müşteri</th><th className="px-3 py-2">Ürünler</th><th className="px-3 py-2 text-right">Tutar</th><th className="px-3 py-2">Kargo</th><th className="px-3 py-2">Durum</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.items.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-2"><Link href={`/siparisler/${o.id}`} className="font-medium hover:underline">{o.orderNumber ?? o.externalId}</Link>{o.isDemo && <span className="ml-1 text-[10px] text-slate-400">DEMO</span>}<div className="text-xs text-slate-500">{new Date(o.orderedAt).toLocaleString('tr-TR')}</div></td>
                  <td className="px-3 py-2">{o.channelAccount.channel.name}<div className="text-xs text-slate-500">{o.channelAccount.label}</div></td>
                  <td className="px-3 py-2">{o.customerName ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">{o.items.map((i) => <div key={i.id} className={i.variantId ? '' : 'text-amber-600'}>{i.quantity}× {i.name}{!i.variantId && ' (eşleşmedi)'}</div>)}</td>
                  <td className="px-3 py-2 text-right">{fmtTRY(Number(o.grandTotal))}</td>
                  <td className="px-3 py-2 text-xs">{o.shipments[0]?.carrierName ?? '—'}{o.shipments[0]?.trackingNumber && <div className="font-mono">{o.shipments[0].trackingNumber}</div>}</td>
                  <td className="px-3 py-2"><Badge tone={ORDER_STATUS[o.status]?.t ?? 'neutral'}>{ORDER_STATUS[o.status]?.l ?? o.status}</Badge><div className="text-[10px] text-slate-400">{o.channelStatus}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.pageCount > 1 && (
        <div className="flex items-center gap-2 text-sm"><button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Önceki</button><span>Sayfa {data.page} / {data.pageCount} · {data.total} sipariş</span><button className="btn-secondary" disabled={page >= data.pageCount} onClick={() => setPage(page + 1)}>Sonraki</button></div>
      )}
    </div>
  );
}
