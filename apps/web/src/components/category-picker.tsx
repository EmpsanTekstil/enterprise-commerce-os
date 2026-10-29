'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';

export interface Category { id: string; name: string; path: string; parentId: string | null }

/** İç kategori seçici; satır içi yeni kategori ekleme destekler. */
export function CategoryPicker({ value, onChange }: { value: string | null | undefined; onChange: (id: string | null) => void }) {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const create = useMutation({
    mutationFn: () => api<Category>('/categories', { method: 'POST', body: JSON.stringify({ name, parentId: parentId || undefined }) }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['categories'] }); onChange(c.id); setAdding(false); setName(''); },
  });
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Kategori seçilmedi</option>
          {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.path}</option>)}
        </select>
        <button type="button" className="btn-secondary whitespace-nowrap" onClick={() => setAdding(!adding)}>Yeni</button>
      </div>
      {adding && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
          <select className="input max-w-[220px]" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Ana kategori olarak</option>
            {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.path} altına</option>)}
          </select>
          <input className="input max-w-[220px]" placeholder="Kategori adı" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="button" className="btn-primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Ekle</button>
          {create.error && <span className="text-xs text-rose-600">{(create.error as Error).message}</span>}
        </div>
      )}
    </div>
  );
}
