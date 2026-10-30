'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';

interface Note { id: string; level: string; title: string; body: string | null; link: string | null; isRead: boolean; createdAt: string }

export function NotificationsBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const count = useQuery({ queryKey: ['notifications-count'], queryFn: () => api<{ count: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  const list = useQuery({ queryKey: ['notifications'], queryFn: () => api<Note[]>('/notifications'), enabled: open });
  const read = useMutation({ mutationFn: (ids?: string[]) => api('/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['notifications-count'] }); } });
  const n = count.data?.count ?? 0;
  const color: Record<string, string> = { ERROR: 'text-rose-600', WARNING: 'text-amber-600', INFO: 'text-brand-600' };
  return (
    <div className="relative">
      <button className="btn-secondary relative !px-2" onClick={() => setOpen(!open)} aria-label="Bildirimler"><Bell className="h-4 w-4" />{n > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold text-white">{n > 99 ? '99+' : n}</span>}</button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between px-2 py-1 text-sm"><span className="font-medium">Bildirimler</span>{n > 0 && <button className="text-xs text-brand-600 underline" onClick={() => read.mutate(undefined)}>Tümünü okundu say</button>}</div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto text-sm dark:divide-slate-800">
            {list.data?.length === 0 && <li className="px-2 py-3 text-slate-500">Bildirim yok.</li>}
            {list.data?.map((x) => (
              <li key={x.id} className={`px-2 py-2 ${x.isRead ? 'opacity-60' : ''}`}>
                <div className={`font-medium ${color[x.level] ?? ''}`}>{x.title}</div>
                {x.body && <div className="whitespace-pre-wrap text-xs text-slate-500">{x.body.slice(0, 200)}</div>}
                <div className="flex items-center gap-2 text-xs text-slate-400"><span>{new Date(x.createdAt).toLocaleString('tr-TR')}</span>{x.link && <Link href={x.link} className="text-brand-600 underline" onClick={() => { read.mutate([x.id]); setOpen(false); }}>Aç</Link>}{!x.isRead && <button className="underline" onClick={() => read.mutate([x.id])}>okundu</button>}</div>
              </li>))}
          </ul>
        </div>
      )}
    </div>
  );
}
