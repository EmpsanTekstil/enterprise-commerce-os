'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge, Empty } from '@/components/ui';
import { api } from '@/lib/api';

interface Q { id: string; text: string; status: string; askedAt: string; overdue: boolean; customerName: string | null; product: { name: string } | null; channelAccount: { channel: { name: string } } }
interface R { id: string; rating: number; text: string | null; reviewedAt: string; customerName: string | null; product: { name: string } | null; channelAccount: { channel: { name: string } }; responses: { sentAt: string | null }[] }
interface Ret { id: string; status: string; requestedAt: string; customerName: string | null; reason: string | null; order: { orderNumber: string | null; externalId: string; channelAccount: { channel: { name: string } } } }
interface N { id: string; level: string; title: string; link: string | null; createdAt: string; isRead: boolean }

/** Birleşik gelen kutusu: cevap bekleyen sorular, cevapsız olumsuz yorumlar, bekleyen iadeler, okunmamış bildirimler — tek zaman çizelgesi. */
export default function InboxPage() {
  const q = useQuery({ queryKey: ['inbox-q'], queryFn: () => api<{ items: Q[] }>('/questions?status=PENDING&pageSize=50') });
  const r = useQuery({ queryKey: ['inbox-r'], queryFn: () => api<{ items: R[] }>('/reviews?sentiment=NEGATIVE&pageSize=50') });
  const ret = useQuery({ queryKey: ['inbox-ret'], queryFn: () => api<{ items: Ret[] }>('/returns?status=REQUESTED&pageSize=50') });
  const n = useQuery({ queryKey: ['inbox-n'], queryFn: () => api<N[]>('/notifications?unread=1') });
  type Item = { kind: 'soru' | 'yorum' | 'iade' | 'bildirim'; at: string; title: string; sub: string; href: string; tone: 'warn' | 'bad' | 'info' | 'neutral' };
  const items: Item[] = [
    ...(q.data?.items ?? []).map<Item>((x) => ({ kind: 'soru', at: x.askedAt, title: x.text.slice(0, 140), sub: `${x.channelAccount.channel.name} · ${x.customerName ?? 'Müşteri'}${x.product ? ` · ${x.product.name}` : ''}`, href: '/sorular', tone: x.overdue ? 'bad' : 'warn' })),
    ...(r.data?.items ?? []).filter((x) => !x.responses.some((y) => y.sentAt)).map<Item>((x) => ({ kind: 'yorum', at: x.reviewedAt, title: `${'★'.repeat(x.rating)} ${x.text?.slice(0, 120) ?? ''}`, sub: `${x.channelAccount.channel.name} · ${x.product?.name ?? ''}`, href: '/yorumlar?sentiment=NEGATIVE', tone: 'bad' })),
    ...(ret.data?.items ?? []).map<Item>((x) => ({ kind: 'iade', at: x.requestedAt, title: `İade talebi · ${x.order.orderNumber ?? x.order.externalId}${x.reason ? ` · ${x.reason}` : ''}`, sub: `${x.order.channelAccount.channel.name} · ${x.customerName ?? ''}`, href: '/kargo', tone: 'warn' })),
    ...(n.data ?? []).map<Item>((x) => ({ kind: 'bildirim', at: x.createdAt, title: x.title, sub: 'Sistem bildirimi', href: x.link ?? '/', tone: x.level === 'ERROR' ? 'bad' : x.level === 'WARNING' ? 'warn' : 'info' })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const K: Record<Item['kind'], string> = { soru: 'Soru', yorum: 'Olumsuz yorum', iade: 'İade', bildirim: 'Bildirim' };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{(['soru', 'yorum', 'iade', 'bildirim'] as const).map((k) => <div key={k} className="card"><div className="text-xs text-slate-500">{K[k]}</div><div className="text-2xl font-semibold">{items.filter((i) => i.kind === k).length}</div></div>)}</div>
      {items.length === 0 && <Empty title="Gelen kutusu boş" hint="Bekleyen soru, olumsuz yorum, iade talebi veya okunmamış bildirim yok." />}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">{items.map((i, idx) => <li key={idx} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><Badge tone={i.tone}>{K[i.kind]}</Badge><Link href={i.href} className="font-medium hover:underline">{i.title}</Link><span className="text-xs text-slate-500">{i.sub}</span><span className="ml-auto text-xs text-slate-400">{new Date(i.at).toLocaleString('tr-TR')}</span></li>)}</ul>
    </div>
  );
}
