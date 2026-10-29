'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Empty, ErrorBox } from '@/components/ui';
import { api } from '@/lib/api';
import { ORDER_STATUS } from '@/lib/status';

interface Ret { id: string; externalId: string | null; status: string; channelStatus: string | null; reason: string | null; customerName: string | null; trackingNumber: string | null; stockRestored: boolean; canActViaApi: boolean; requestedAt: string; itemsJson: { claimItemId: string; name?: string; sku?: string; quantity: number; reason?: string; note?: string }[]; order: { id: string; orderNumber: string | null; externalId: string; channelAccount: { id: string; label: string; channel: { name: string } } } }
interface Order { id: string; orderNumber: string | null; externalId: string; status: string; orderedAt: string; channelAccount: { channel: { name: string } }; shipments: { carrierName: string | null; trackingNumber: string | null; trackingUrl: string | null; status: string }[] }

const RET: Record<string, { l: string; t: 'ok' | 'warn' | 'bad' | 'info' | 'neutral' }> = { REQUESTED: { l: 'Bekliyor', t: 'warn' }, APPROVED: { l: 'Onaylandı', t: 'info' }, REJECTED: { l: 'Reddedildi', t: 'bad' }, IN_TRANSIT: { l: 'Yolda', t: 'info' }, RECEIVED: { l: 'Teslim alındı', t: 'ok' }, REFUNDED: { l: 'İade edildi', t: 'ok' }, CLOSED: { l: 'Kapandı', t: 'neutral' } };

export default function ShippingReturnsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'kargo' | 'iade'>('kargo');
  const [status, setStatus] = useState('');
  const [reject, setReject] = useState<Ret | null>(null);
  const [reason, setReason] = useState(''); const [desc, setDesc] = useState('');
  const toShip = useQuery({ queryKey: ['orders-to-ship'], queryFn: () => api<{ items: Order[] }>('/orders?pageSize=100&status=NEW'), enabled: tab === 'kargo' });
  const shipped = useQuery({ queryKey: ['orders-shipped'], queryFn: () => api<{ items: Order[] }>('/orders?pageSize=100&status=SHIPPED'), enabled: tab === 'kargo' });
  const returns = useQuery({ queryKey: ['returns', status], queryFn: () => api<{ items: Ret[]; total: number }>(`/returns?pageSize=100${status ? `&status=${status}` : ''}`), enabled: tab === 'iade' });
  const reasons = useQuery({ queryKey: ['reject-reasons', reject?.order.channelAccount.id], queryFn: () => api<{ id: string; name: string }[]>(`/returns/reject-reasons/${reject!.order.channelAccount.id}`), enabled: !!reject });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['returns'] }); qc.invalidateQueries({ queryKey: ['products'] }); };
  const approve = useMutation({ mutationFn: (id: string) => api(`/returns/${id}/approve`, { method: 'POST', body: '{}' }), onSuccess: refresh });
  const restock = useMutation({ mutationFn: (id: string) => api<{ restored: number; skipped: string[] }>(`/returns/${id}/restock`, { method: 'POST', body: '{}' }), onSuccess: refresh });
  const doReject = useMutation({ mutationFn: () => api(`/returns/${reject!.id}/reject`, { method: 'POST', body: JSON.stringify({ reasonId: reason, description: desc }) }), onSuccess: () => { setReject(null); refresh(); } });
  const late = (o: Order) => Date.now() - new Date(o.orderedAt).getTime() > 2 * 86_400_000;
  const err = (approve.error ?? restock.error ?? doReject.error ?? returns.error) as Error | null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2"><button className={tab === 'kargo' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('kargo')}>Kargo</button><button className={tab === 'iade' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('iade')}>İadeler</button></div>
      {err && <ErrorBox message={err.message} />}

      {tab === 'kargo' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card">
            <div className="mb-2 font-medium">Kargolanacak siparişler <span className="text-sm text-slate-500">({toShip.data?.items.length ?? 0})</span></div>
            {toShip.data?.items.length === 0 && <div className="text-sm text-slate-500">Bekleyen sipariş yok.</div>}
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {toShip.data?.items.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <Link href={`/siparisler/${o.id}`} className="font-medium hover:underline">{o.orderNumber ?? o.externalId}</Link>
                  <span className="text-slate-500">{o.channelAccount.channel.name}</span>
                  <span className="text-xs text-slate-500">{new Date(o.orderedAt).toLocaleString('tr-TR')}</span>
                  {late(o) && <Badge tone="bad">Gecikiyor</Badge>}
                </li>
              ))}
            </ul>
            <div className="mt-2 text-xs text-slate-500">Kargo etiketi ve takip numarası pazaryerinin kendi kargo süreciyle oluşur; sistem bunları sipariş senkronuyla içeri alır.</div>
          </section>
          <section className="card">
            <div className="mb-2 font-medium">Yolda olanlar <span className="text-sm text-slate-500">({shipped.data?.items.length ?? 0})</span></div>
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {shipped.data?.items.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <Link href={`/siparisler/${o.id}`} className="font-medium hover:underline">{o.orderNumber ?? o.externalId}</Link>
                  <span className="text-slate-500">{o.shipments[0]?.carrierName ?? '—'}</span>
                  <span className="font-mono text-xs">{o.shipments[0]?.trackingNumber ?? ''}</span>
                  {o.shipments[0]?.trackingUrl && <a className="text-xs text-brand-600 underline" href={o.shipments[0].trackingUrl} target="_blank" rel="noreferrer">Takip</a>}
                  <Badge tone={ORDER_STATUS[o.status]?.t ?? 'neutral'}>{ORDER_STATUS[o.status]?.l}</Badge>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {tab === 'iade' && (
        <div className="space-y-3">
          <select className="input max-w-[200px]" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tüm iadeler</option>{Object.entries(RET).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</select>
          {returns.data?.items.length === 0 && <Empty title="İade yok" hint="İadeler kanallardan 15 dakikada bir otomatik çekilir; Yayınlar sayfasından da elle tetiklenebilir." />}
          {returns.data?.items.map((r) => (
            <div key={r.id} className="card space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/siparisler/${r.order.id}`} className="font-medium hover:underline">{r.order.orderNumber ?? r.order.externalId}</Link>
                <span className="text-slate-500">{r.order.channelAccount.channel.name} · {r.customerName ?? ''}</span>
                <span className="text-xs text-slate-500">{new Date(r.requestedAt).toLocaleString('tr-TR')}</span>
                <Badge tone={RET[r.status]?.t ?? 'neutral'}>{RET[r.status]?.l ?? r.status}</Badge>
                {r.stockRestored && <Badge tone="ok">Stoğa alındı</Badge>}
                {r.trackingNumber && <span className="font-mono text-xs">{r.trackingNumber}</span>}
              </div>
              <ul className="text-xs text-slate-600 dark:text-slate-300">{r.itemsJson.map((i) => <li key={i.claimItemId}>{i.quantity}× {i.name ?? i.sku ?? i.claimItemId}{i.reason ? ` — ${i.reason}` : ''}{i.note ? ` (${i.note})` : ''}</li>)}</ul>
              <div className="flex flex-wrap gap-2">
                {r.status === 'REQUESTED' && r.canActViaApi && <button className="btn-primary" disabled={approve.isPending} onClick={() => { if (confirm('İade onaylansın mı?')) approve.mutate(r.id); }}>Onayla</button>}
                {r.status === 'REQUESTED' && r.canActViaApi && <button className="btn-secondary" onClick={() => { setReject(r); setReason(''); setDesc(''); }}>Ret talebi</button>}
                {r.status === 'REQUESTED' && !r.canActViaApi && <span className="text-xs text-amber-700">Bu kanalda onay/ret yalnızca satıcı panelinden yapılabilir.</span>}
                {!r.stockRestored && r.status !== 'REJECTED' && r.status !== 'CLOSED' && <button className="btn-secondary" disabled={restock.isPending} onClick={() => { if (confirm('Ürünler fiziksel olarak kontrol edildi ve stoğa eklenecek. Devam?')) restock.mutate(r.id); }}>Stoğa al</button>}
              </div>
              {restock.data && restock.variables === r.id && <div className="text-xs text-emerald-600">{restock.data.restored} adet stoğa eklendi{restock.data.skipped.length ? `; eşleşmeyen: ${restock.data.skipped.join(', ')}` : ''}</div>}
            </div>
          ))}
        </div>
      )}

      {reject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setReject(null)}>
          <form className="card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); doReject.mutate(); }}>
            <div className="font-medium">İade ret talebi</div>
            <div><label className="label">Sebep</label><select className="input" required value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Seçin</option>{reasons.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            <div><label className="label">Açıklama (en fazla 500)</label><textarea className="input" required maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
            <div className="text-xs text-amber-700">Trendyol çoğu ret sebebinde kanıt dosyası ister; dosya gerektiren sebepler için talebi satıcı panelinden açın.</div>
            {doReject.error && <ErrorBox message={(doReject.error as Error).message} />}
            <div className="flex gap-2"><button className="btn-primary" disabled={doReject.isPending}>Gönder</button><button type="button" className="btn-secondary" onClick={() => setReject(null)}>Vazgeç</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
