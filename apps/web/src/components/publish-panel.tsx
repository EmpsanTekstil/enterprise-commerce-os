'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Badge, ErrorBox } from './ui';

interface Account { id: string; label: string; status: string; channel: { code: string; name: string }; }
interface Prepared { variantId: string; sku: string; problems: string[]; warnings: string[]; product?: { title: string; price?: number; salePrice?: number; stock?: number; channelAttributes?: { attributeId: string; valueId?: string; customValue?: string }[] } }
interface PublishResult { requested: number; sent: number; failed: number; blocked: { sku: string; problems: string[] }[]; batchRequestId?: string }

/** Ürün detayında: seçili kanal hesabı için varyantları kontrol et ve yayınla. */
export function PublishPanel({ productId, variants }: { productId: string; variants: { id: string; sku: string; listings: { status: string; lastError: string | null; channelAccount: { id: string } }[] }[] }) {
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ['channel-accounts'], queryFn: () => api<Account[]>('/channels/accounts') });
  const [accountId, setAccountId] = useState('');
  const [selected, setSelected] = useState<string[]>(variants.map((v) => v.id));
  const connected = accounts.data?.filter((a) => a.status === 'CONNECTED') ?? [];
  const prepare = useMutation({ mutationFn: () => api<Prepared[]>('/listings/prepare', { method: 'POST', body: JSON.stringify({ accountId, variantIds: selected }) }) });
  const publish = useMutation({
    mutationFn: () => api<PublishResult>('/listings/publish', { method: 'POST', body: JSON.stringify({ accountId, variantIds: selected }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['product', productId] }); prepare.reset(); },
  });
  const ready = prepare.data?.filter((p) => p.problems.length === 0).length ?? 0;
  const statusOf = (v: typeof variants[number]) => v.listings.find((l) => l.channelAccount.id === accountId);
  const STATUS: Record<string, { l: string; t: 'ok' | 'warn' | 'bad' | 'info' | 'neutral' }> = { ACTIVE: { l: 'Yayında', t: 'ok' }, PENDING: { l: 'Kanal onayı bekliyor', t: 'info' }, REJECTED: { l: 'Reddedildi', t: 'bad' }, ERROR: { l: 'Hata', t: 'bad' }, PAUSED: { l: 'Durduruldu', t: 'neutral' }, DRAFT: { l: 'Taslak', t: 'warn' }, UNLINKED: { l: 'Eşleşmedi', t: 'warn' } };

  return (
    <section className="card space-y-3">
      <div className="font-medium">Kanallarda yayınla</div>
      {connected.length === 0 ? <div className="text-sm text-slate-500">Bağlı kanal hesabı yok. Entegrasyonlar sayfasından ekleyip bağlantıyı test edin.</div> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input max-w-xs" value={accountId} onChange={(e) => { setAccountId(e.target.value); prepare.reset(); publish.reset(); }}>
              <option value="">Kanal hesabı seçin</option>{connected.map((a) => <option key={a.id} value={a.id}>{a.channel.name} · {a.label}</option>)}
            </select>
            <button className="btn-secondary" disabled={!accountId || !selected.length || prepare.isPending} onClick={() => prepare.mutate()}>{prepare.isPending ? 'Kontrol ediliyor…' : 'Hazırlık kontrolü'}</button>
            <button className="btn-primary" disabled={!prepare.data || ready === 0 || publish.isPending} onClick={() => { if (confirm(`${ready} varyant kanala gönderilecek. Devam?`)) publish.mutate(); }}>{publish.isPending ? 'Gönderiliyor…' : `Yayınla (${ready})`}</button>
          </div>
          <div className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {variants.map((v) => {
              const p = prepare.data?.find((x) => x.variantId === v.id); const st = statusOf(v);
              return (
                <div key={v.id} className="flex flex-wrap items-start gap-2 py-2">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(v.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, v.id] : selected.filter((x) => x !== v.id))} /><span className="font-mono text-xs">{v.sku}</span></label>
                  {accountId && st && <Badge tone={STATUS[st.status]?.t ?? 'neutral'}>{STATUS[st.status]?.l ?? st.status}</Badge>}
                  {accountId && st?.lastError && <span className="text-xs text-rose-600">{st.lastError}</span>}
                  {p && (p.problems.length === 0 ? <Badge tone="ok">Hazır</Badge> : <ul className="list-disc pl-5 text-xs text-rose-700">{p.problems.map((m) => <li key={m}>{m}</li>)}</ul>)}
                  {p?.warnings.map((w) => <span key={w} className="text-xs text-amber-700">{w}</span>)}
                </div>
              );
            })}
          </div>
          {publish.data && <div className="text-sm">{publish.data.sent} gönderildi{publish.data.blocked.length ? `, ${publish.data.blocked.length} eksik nedeniyle gönderilmedi` : ''}{publish.data.sent ? ' — kanal onayı birkaç dakika sürebilir; sonuç otomatik kontrol edilir.' : ''}</div>}
          {(prepare.error ?? publish.error) && <ErrorBox message={((prepare.error ?? publish.error) as Error).message} />}
        </>
      )}
    </section>
  );
}
