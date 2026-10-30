'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Empty, ErrorBox } from '@/components/ui';
import { api } from '@/lib/api';

interface Response { id: string; source: string; text: string; isApproved: boolean; sentAt: string | null; error: string | null; createdAt: string; author: { fullName: string } | null }
interface Q { id: string; externalId: string; text: string; status: string; customerName: string | null; askedAt: string; dueAt: string | null; overdue: boolean; canReplyViaApi: boolean; product: { id: string; name: string } | null; channelAccount: { id: string; label: string; channel: { code: string; name: string } }; assignedTo: { id: string; fullName: string } | null; responses: Response[] }
interface Page { items: Q[]; total: number; counts: Record<string, number> }
interface Template { id: string; title: string; body: string }
interface Account { id: string; label: string; status: string; channel: { name: string } }

const ST: Record<string, { l: string; t: 'warn' | 'info' | 'ok' | 'neutral' | 'bad' }> = { OPEN: { l: 'Cevap bekliyor', t: 'warn' }, DRAFTED: { l: 'Taslak var', t: 'info' }, ANSWERED: { l: 'Cevaplandı', t: 'ok' }, REJECTED: { l: 'Reddedildi', t: 'bad' }, CLOSED: { l: 'Kapatıldı', t: 'neutral' } };
const SRC: Record<string, string> = { HUMAN: 'Personel', TEMPLATE: 'Şablon', AI_DRAFT: 'Yapay zekâ taslağı' };

export default function QuestionsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('PENDING'); const [accountId, setAccountId] = useState(''); const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null); const [text, setText] = useState('');
  const accounts = useQuery({ queryKey: ['channel-accounts'], queryFn: () => api<Account[]>('/channels/accounts') });
  const list = useQuery({ queryKey: ['questions', status, accountId, q], queryFn: () => api<Page>(`/questions?pageSize=100${status ? `&status=${status}` : ''}${accountId ? `&accountId=${accountId}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`), refetchInterval: 60_000 });
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api<Template[]>('/questions/templates/all') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['questions'] });
  const pull = useMutation({ mutationFn: (id: string) => api(`/sync/accounts/${id}/run`, { method: 'POST', body: JSON.stringify({ type: 'QUESTION_PULL' }) }), onSuccess: refresh });
  const draft = useMutation({ mutationFn: (p: { id: string; text: string; source?: string }) => api(`/questions/${p.id}/draft`, { method: 'POST', body: JSON.stringify({ text: p.text, source: p.source }) }), onSuccess: () => { setText(''); refresh(); } });
  const aiDraft = useMutation({ mutationFn: (id: string) => api<{ missingInfo: boolean; costUsd: number }>(`/questions/${id}/ai-draft`, { method: 'POST' }), onSuccess: refresh });
  const send = useMutation({ mutationFn: (p: { id: string; responseId: string; markOnly?: boolean }) => api(`/questions/${p.id}/send`, { method: 'POST', body: JSON.stringify({ responseId: p.responseId, markOnly: p.markOnly }) }), onSuccess: refresh });
  const close = useMutation({ mutationFn: (id: string) => api(`/questions/${id}/close`, { method: 'POST' }), onSuccess: refresh });
  const err = (draft.error ?? aiDraft.error ?? send.error ?? pull.error ?? list.error) as Error | null;
  const c = list.data?.counts ?? {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['PENDING', 'Cevap bekleyen', (c.OPEN ?? 0) + (c.DRAFTED ?? 0)], ['OPEN', 'Taslaksız', c.OPEN ?? 0], ['DRAFTED', 'Onay bekleyen taslak', c.DRAFTED ?? 0], ['ANSWERED', 'Cevaplanan', c.ANSWERED ?? 0]].map(([k, l, n]) => (
          <button key={k as string} onClick={() => setStatus(k as string)} className={`card text-left ${status === k ? 'ring-2 ring-brand-500' : ''}`}><div className="text-xs text-slate-500">{l}</div><div className="text-2xl font-semibold">{n as number}</div></button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-xs" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Tüm kanallar</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.channel.name} · {a.label}</option>)}</select>
        <input className="input max-w-xs" placeholder="Soru, müşteri veya ürün ara" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tüm durumlar</option><option value="PENDING">Cevap bekleyen</option>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</select>
        {accountId && <button className="btn-secondary" disabled={pull.isPending} onClick={() => pull.mutate(accountId)}>Soruları şimdi çek</button>}
      </div>
      {err && <ErrorBox message={err.message} />}
      {list.data?.items.length === 0 && <Empty title="Soru yok" hint="Sorular bağlı kanallardan 15 dakikada bir otomatik çekilir." />}

      {list.data?.items.map((item) => (
        <div key={item.id} className={`card space-y-2 ${item.overdue ? 'border-rose-300 dark:border-rose-800' : ''}`}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={ST[item.status]?.t ?? 'neutral'}>{ST[item.status]?.l ?? item.status}</Badge>
            {item.overdue && <Badge tone="bad">Yanıt süresi aşıldı</Badge>}
            <span className="font-medium">{item.channelAccount.channel.name}</span><span className="text-slate-500">{item.channelAccount.label}</span>
            <span className="text-xs text-slate-500">{new Date(item.askedAt).toLocaleString('tr-TR')} · {item.customerName ?? 'Müşteri'}</span>
            {item.product ? <Link href={`/urunler/${item.product.id}`} className="text-brand-600 underline">{item.product.name}</Link> : <span className="text-xs text-amber-700">Ürün eşleşmedi</span>}
            {item.assignedTo && <span className="ml-auto text-xs text-slate-500">Atanan: {item.assignedTo.fullName}</span>}
          </div>
          <p className="whitespace-pre-wrap">{item.text}</p>
          {item.responses.length > 0 && (
            <div className="space-y-1 rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800/50">
              {item.responses.map((r) => (
                <div key={r.id} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><span>{SRC[r.source] ?? r.source}</span>{r.author && <span>· {r.author.fullName}</span>}<span>· {new Date(r.createdAt).toLocaleString('tr-TR')}</span>{r.sentAt ? <Badge tone="ok">Gönderildi</Badge> : <Badge tone="warn">Onay bekliyor</Badge>}{r.error && <span className="text-rose-600">{r.error}</span>}</div>
                  <p className={`whitespace-pre-wrap ${r.text.startsWith('BİLGİ YOK') ? 'text-amber-800 dark:text-amber-300' : ''}`}>{r.text}</p>
                  {!r.sentAt && item.status !== 'ANSWERED' && (
                    <div className="flex flex-wrap gap-2">
                      {item.canReplyViaApi ? <button className="btn-primary !py-1" disabled={send.isPending} onClick={() => { if (confirm('Bu cevap müşteriye kanal üzerinden gönderilecek. Onaylıyor musunuz?')) send.mutate({ id: item.id, responseId: r.id }); }}>Onayla ve gönder</button>
                        : <button className="btn-secondary !py-1" onClick={() => { navigator.clipboard?.writeText(r.text); if (confirm('Cevap panoya kopyalandı. Kanal panelinden gönderdiyseniz "cevaplandı" olarak işaretlensin mi?')) send.mutate({ id: item.id, responseId: r.id, markOnly: true }); }}>Kopyala · panelden gönderildi</button>}
                      <button className="btn-secondary !py-1" onClick={() => { setOpen(item.id); setText(r.text); }}>Düzenle</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {item.status !== 'ANSWERED' && item.status !== 'CLOSED' && (
            <div className="space-y-2">
              {open === item.id ? (
                <div className="space-y-2">
                  <textarea className="input min-h-[90px]" value={text} onChange={(e) => setText(e.target.value)} placeholder="Cevap taslağı (en az 10 karakter)" />
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-primary !py-1" disabled={text.trim().length < 10 || draft.isPending} onClick={() => { draft.mutate({ id: item.id, text }); setOpen(null); }}>Taslağı kaydet</button>
                    <select className="input max-w-[220px] !py-1" onChange={(e) => { const t = templates.data?.find((x) => x.id === e.target.value); if (t) setText(t.body); }} defaultValue=""><option value="">Şablondan doldur…</option>{templates.data?.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
                    <button className="btn-secondary !py-1" onClick={() => setOpen(null)}>Vazgeç</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button className="btn-secondary !py-1" onClick={() => { setOpen(item.id); setText(''); }}>Cevap yaz</button>
                  <button className="btn-secondary !py-1" disabled={aiDraft.isPending} onClick={() => aiDraft.mutate(item.id)}>{aiDraft.isPending && aiDraft.variables === item.id ? 'Yazılıyor…' : 'Yapay zekâ taslağı'}</button>
                  <button className="btn-secondary !py-1" onClick={() => { if (confirm('Soru cevapsız kapatılsın mı?')) close.mutate(item.id); }}>Kapat</button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      <div className="text-xs text-slate-500">Yapay zekâ taslakları yalnızca ürün kataloğundaki bilgilere dayanır; bilgi yoksa "BİLGİ YOK" ile başlar ve eksik yeri işaretler. Hiçbir cevap onaysız gönderilmez.</div>
    </div>
  );
}
