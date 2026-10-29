'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, ErrorBox } from '@/components/ui';
import { api, fmtTRY } from '@/lib/api';
import { ORDER_STATUS } from '@/lib/status';

interface Detail {
  id: string; orderNumber: string | null; externalId: string; status: string; channelStatus: string | null; customerName: string | null; customerEmail: string | null; customerPhone: string | null;
  shippingAddress: Record<string, unknown> | null; grandTotal: string; commissionTotal: string | null; orderedAt: string;
  channelAccount: { label: string; channel: { name: string } };
  items: { id: string; name: string; sku: string | null; barcode: string | null; quantity: number; unitPrice: string; lineTotal: string; commission: string | null; variant: { sku: string; costPrice: string | null; product: { id: string; name: string } } | null }[];
  shipments: { id: string; carrierName: string | null; trackingNumber: string | null; trackingUrl: string | null; status: string }[];
  history: { id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }[];
  profitEstimate: { revenue: number; commission: number; cost: number; net: number };
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api<Detail>(`/orders/${id}`) });
  const [inv, setInv] = useState(''); const [trk, setTrk] = useState('');
  const fulfill = useMutation({ mutationFn: (action: 'picking' | 'invoiced') => api(`/orders/${id}/fulfill`, { method: 'POST', body: JSON.stringify({ action, invoiceNumber: inv || undefined, trackingNumber: trk || undefined }) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['order', id] }); qc.invalidateQueries({ queryKey: ['orders'] }); } });
  if (q.error) return <ErrorBox message={(q.error as Error).message} />;
  if (!q.data) return <div className="text-sm text-slate-500">Yükleniyor…</div>;
  const o = q.data; const p = o.profitEstimate;
  const addr = o.shippingAddress ? Object.values(o.shippingAddress).filter((v) => typeof v === 'string' && v).join(', ') : '—';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">{o.orderNumber ?? o.externalId}</h2>
        <Badge tone={ORDER_STATUS[o.status]?.t ?? 'neutral'}>{ORDER_STATUS[o.status]?.l ?? o.status}</Badge>
        <span className="text-sm text-slate-500">{o.channelAccount.channel.name} · {o.channelAccount.label} · {new Date(o.orderedAt).toLocaleString('tr-TR')}</span>
      </div>
      {['NEW', 'CONFIRMED', 'PICKING'].includes(o.status) && (
        <section className="card flex flex-wrap items-end gap-2 text-sm">
          <div className="font-medium">Paketleme</div>
          {o.status !== 'PICKING' && <button className="btn-secondary" disabled={fulfill.isPending} onClick={() => fulfill.mutate('picking')}>Toplamaya başla</button>}
          <div><label className="label">Fatura no</label><input className="input w-44" value={inv} onChange={(e) => setInv(e.target.value)} /></div>
          <div><label className="label">Takip no (kendi kargon varsa)</label><input className="input w-44" value={trk} onChange={(e) => setTrk(e.target.value)} /></div>
          <button className="btn-primary" disabled={!inv || fulfill.isPending} onClick={() => { if (confirm('Kanala "faturalandı/paketlendi" bildirilecek. Devam?')) fulfill.mutate('invoiced'); }}>Faturalandı · Paketlendi</button>
          {fulfill.error && <ErrorBox message={(fulfill.error as Error).message} />}
          <div className="w-full text-xs text-slate-500">Trendyol'da kargo etiketi kanal tarafından üretilir; takip numarası yalnızca kendi kargo anlaşmanız varsa girilir.</div>
        </section>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card text-sm space-y-1"><div className="font-medium">Müşteri</div><div>{o.customerName ?? '—'}</div><div className="text-slate-500">{o.customerEmail ?? ''} {o.customerPhone ?? ''}</div><div className="text-slate-500">{addr}</div></section>
        <section className="card text-sm space-y-1"><div className="font-medium">Kargo</div>{o.shipments.length === 0 ? <div className="text-slate-500">Henüz kargo bilgisi yok</div> : o.shipments.map((s) => <div key={s.id}>{s.carrierName ?? '—'} · <span className="font-mono">{s.trackingNumber ?? '—'}</span>{s.trackingUrl && <a className="ml-2 text-brand-600 underline" href={s.trackingUrl} target="_blank" rel="noreferrer">Takip</a>}</div>)}</section>
        <section className="card text-sm space-y-1"><div className="font-medium">Sipariş kârlılığı (tahmini)</div>
          <div className="flex justify-between"><span>Satış</span><span>{fmtTRY(p.revenue)}</span></div>
          <div className="flex justify-between text-slate-500"><span>Komisyon</span><span>−{fmtTRY(p.commission)}</span></div>
          <div className="flex justify-between text-slate-500"><span>Ürün maliyeti</span><span>−{fmtTRY(p.cost)}</span></div>
          <div className={`flex justify-between font-medium ${p.net < 0 ? 'text-rose-600' : 'text-emerald-600'}`}><span>Net</span><span>{fmtTRY(p.net)}</span></div>
          <div className="text-xs text-slate-400">Kargo/paketleme/reklam maliyeti Fiyat Yönetimi kurallarıyla eklenecek.</div>
        </section>
      </div>
      <section className="card overflow-x-auto !p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50"><tr><th className="px-3 py-2">Ürün</th><th className="px-3 py-2">SKU / Barkod</th><th className="px-3 py-2 text-right">Adet</th><th className="px-3 py-2 text-right">Birim</th><th className="px-3 py-2 text-right">Tutar</th><th className="px-3 py-2 text-right">Komisyon</th><th className="px-3 py-2">Merkezi ürün</th></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {o.items.map((i) => (
              <tr key={i.id}><td className="px-3 py-2">{i.name}</td><td className="px-3 py-2 font-mono text-xs">{i.sku ?? '—'} / {i.barcode ?? '—'}</td><td className="px-3 py-2 text-right">{i.quantity}</td><td className="px-3 py-2 text-right">{fmtTRY(Number(i.unitPrice))}</td><td className="px-3 py-2 text-right">{fmtTRY(Number(i.lineTotal))}</td><td className="px-3 py-2 text-right">{i.commission ? fmtTRY(Number(i.commission)) : '—'}</td><td className="px-3 py-2">{i.variant ? i.variant.product.name : <span className="text-amber-600">Eşleşmedi — stok düşülmedi</span>}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card text-sm"><div className="mb-1 font-medium">Sipariş geçmişi</div>
        <ul className="space-y-1">{o.history.map((h) => <li key={h.id} className="flex gap-2"><span className="text-xs text-slate-500">{new Date(h.createdAt).toLocaleString('tr-TR')}</span><span>{h.fromStatus ? `${ORDER_STATUS[h.fromStatus]?.l} → ` : ''}{ORDER_STATUS[h.toStatus]?.l}</span><span className="text-slate-500">{h.note}</span></li>)}</ul>
      </section>
    </div>
  );
}
