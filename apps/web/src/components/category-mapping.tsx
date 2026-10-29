'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { Category } from './category-picker';
import { Badge } from './ui';

interface ChannelCategory { id: string; externalId: string; path: string; isLeaf: boolean }
interface Mapping { id: string; categoryId: string; channelCategory: ChannelCategory }

/** Seçili kanal hesabı için iç kategori → kanal kategorisi eşleştirme paneli. */
export function CategoryMapping({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });
  const maps = useQuery({ queryKey: ['category-mappings', accountId], queryFn: () => api<Mapping[]>(`/categories/mappings/${accountId}`) });
  const [editing, setEditing] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const results = useQuery({ queryKey: ['channel-cat-search', accountId, q], queryFn: () => api<ChannelCategory[]>(`/categories/channel/search?accountId=${accountId}&q=${encodeURIComponent(q)}`), enabled: !!editing });
  const map = useMutation({
    mutationFn: (p: { categoryId: string; channelCategoryId: string }) => api('/categories/mappings', { method: 'POST', body: JSON.stringify({ accountId, ...p }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['category-mappings', accountId] }); setEditing(null); setQ(''); },
  });
  const byCat = new Map(maps.data?.map((m) => [m.categoryId, m]));
  if (!cats.data?.length) return <div className="text-sm text-slate-500">Önce ürünlerinize iç kategori verin (Ürün Oluştur → Kategori).</div>;
  if (results.data && results.data.length === 0 && !q && editing) return <div className="text-sm text-amber-700">Bu hesap için kanal kategorileri çekilmemiş. Üstteki "Kategorileri çek" butonunu kullanın.</div>;
  return (
    <div className="space-y-2 text-sm">
      {cats.data.map((c) => {
        const m = byCat.get(c.id);
        return (
          <div key={c.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{c.path}</span>
              <span className="text-slate-400">→</span>
              {m ? <span>{m.channelCategory.path} <span className="font-mono text-xs text-slate-500">#{m.channelCategory.externalId}</span></span> : <Badge tone="warn">Eşleştirilmedi</Badge>}
              <button className="btn-secondary ml-auto !py-1 text-xs" onClick={() => { setEditing(editing === c.id ? null : c.id); setQ(''); }}>{m ? 'Değiştir' : 'Eşleştir'}</button>
            </div>
            {editing === c.id && (
              <div className="mt-2 space-y-1">
                <input className="input" placeholder="Kanal kategorisi ara (örn. Tişört)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
                <div className="max-h-48 overflow-y-auto rounded border border-slate-200 dark:border-slate-800">
                  {results.data?.map((r) => (
                    <button key={r.id} className="block w-full px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => map.mutate({ categoryId: c.id, channelCategoryId: r.id })}>{r.path} <span className="font-mono text-xs text-slate-500">#{r.externalId}</span></button>
                  ))}
                  {results.data?.length === 0 && q && <div className="px-2 py-1 text-slate-500">Sonuç yok</div>}
                </div>
                {map.error && <div className="text-xs text-rose-600">{(map.error as Error).message}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
