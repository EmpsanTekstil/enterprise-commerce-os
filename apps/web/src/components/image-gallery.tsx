'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ApiError, getToken } from '@/lib/api';

export interface ProductImage { id: string; url: string; width: number | null; height: number | null; sortOrder: number; altText: string | null }
const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Çoklu yükleme (sürükle-bırak veya dosya seç), sıralama (sürükle veya ok tuşları), silme. */
export function ImageGallery({ productId, images }: { productId: string; images: ProductImage[] }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['product', productId] });

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const errs: string[] = [];
      for (const f of files) {
        const fd = new FormData(); fd.append('file', f);
        const res = await fetch(`${BASE}/api/v1/products/${productId}/images`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: fd });
        if (!res.ok) { const b = await res.json().catch(() => ({})); errs.push(`${f.name}: ${b.message ?? res.status}`); }
      }
      setErrors(errs);
      if (errs.length === files.length && files.length) throw new ApiError(400, errs.join('; '));
    },
    onSettled: refresh,
  });
  const reorder = useMutation({ mutationFn: (imageIds: string[]) => fetchJson(`/products/${productId}/images/order`, 'PATCH', { imageIds }), onSettled: refresh });
  const remove = useMutation({ mutationFn: (id: string) => fetchJson(`/products/${productId}/images/${id}`, 'DELETE'), onSettled: refresh });

  const move = (from: number, to: number) => {
    if (to < 0 || to >= images.length) return;
    const ids = images.map((i) => i.id); const [x] = ids.splice(from, 1); ids.splice(to, 0, x); reorder.mutate(ids);
  };

  return (
    <div className="space-y-2">
      <div
        className={`rounded-lg border-2 border-dashed p-4 text-center text-sm ${over ? 'border-brand-500 bg-brand-50 dark:bg-brand-700/10' : 'border-slate-300 dark:border-slate-700'}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')); if (files.length) upload.mutate(files); }}
      >
        Görselleri buraya sürükleyin veya <button type="button" className="text-brand-600 underline" onClick={() => input.current?.click()}>dosya seçin</button>
        <div className="mt-1 text-xs text-slate-500">JPEG/PNG/WebP · en az 500px · en fazla 8 MB · 2000px üstü otomatik küçültülür</div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => { const files = [...(e.target.files ?? [])]; if (files.length) upload.mutate(files); e.target.value = ''; }} />
        {upload.isPending && <div className="mt-1 text-xs">Yükleniyor…</div>}
      </div>
      {errors.map((e) => <div key={e} className="text-xs text-rose-600">{e}</div>)}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {images.map((img, i) => (
            <div key={img.id} draggable onDragStart={() => setDrag(img.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (drag && drag !== img.id) move(images.findIndex((x) => x.id === drag), i); setDrag(null); }}
              className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.altText ?? ''} className="aspect-square w-full object-cover" />
              {i === 0 && <span className="absolute left-1 top-1 rounded bg-brand-600 px-1.5 text-[10px] text-white">Kapak</span>}
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 px-1 py-0.5 text-[11px] text-white opacity-0 transition group-hover:opacity-100">
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0}>◀</button>
                <span>{img.width}×{img.height}</span>
                <button type="button" onClick={() => move(i, i + 1)} disabled={i === images.length - 1}>▶</button>
                <button type="button" onClick={() => { if (confirm('Görsel silinsin mi?')) remove.mutate(img.id); }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function fetchJson(path: string, method: string, body?: unknown) {
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).message ?? `Hata ${res.status}`);
  return res.json();
}
