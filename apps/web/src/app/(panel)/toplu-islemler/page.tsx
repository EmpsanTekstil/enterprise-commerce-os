'use client';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Badge, ErrorBox } from '@/components/ui';
import { api, getToken } from '@/lib/api';

type Kind = 'products' | 'prices' | 'stock';
interface Row { row: number; data: Record<string, string | number | null>; errors: string[]; action?: string }
interface Preview { rows: Row[]; total: number; valid: number; invalid: number; unknownColumns: string[]; message?: string }
interface Result { created?: number; updated?: number; variantsCreated?: number; variantsUpdated?: number; errors: { sku: string; error: string }[] }
const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const KINDS: { k: Kind; l: string; desc: string }[] = [
  { k: 'products', l: 'Ürün yükleme', desc: 'Yeni ürün ve varyant ekler; mevcut SKU\'ları günceller. Aynı "Ürün Grubu" değerine sahip satırlar tek ürünün varyantları olur.' },
  { k: 'prices', l: 'Toplu fiyat', desc: 'SKU bazında satış fiyatı ve alış maliyetini günceller. Kanallara gönderim, Pazaryeri Yayınları → "Stok/fiyat gönder" ile yapılır.' },
  { k: 'stock', l: 'Toplu stok', desc: 'SKU bazında depodaki fiziksel stoğu verilen değere eşitler; fark hareket defterine yazılır.' },
];

export default function BulkPage() {
  const [kind, setKind] = useState<Kind>('products');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`${BASE}/api/v1/bulk/${kind}/preview`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? `Hata ${res.status}`);
      return body as Preview;
    },
    onSuccess: (p) => { setPreview(p); setResult(null); },
  });
  const apply = useMutation({
    mutationFn: () => api<Result>(`/bulk/${kind}/apply`, { method: 'POST', body: JSON.stringify({ rows: preview!.rows.filter((r) => !r.errors.length).map((r) => r.data) }) }),
    onSuccess: (r) => { setResult(r); setPreview(null); },
  });
  const downloadTemplate = async () => {
    const res = await fetch(`${BASE}/api/v1/bulk/${kind}/template`, { headers: { Authorization: `Bearer ${getToken()}` } });
    const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] ?? 'sablon.xlsx'; a.click();
  };
  const columns = preview ? [...new Set(preview.rows.flatMap((r) => Object.keys(r.data)))] : [];
  const shown = preview?.rows.filter((r) => !onlyErrors || r.errors.length) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{KINDS.map((k) => <button key={k.k} className={kind === k.k ? 'btn-primary' : 'btn-secondary'} onClick={() => { setKind(k.k); setPreview(null); setResult(null); }}>{k.l}</button>)}</div>
      <div className="card space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">{KINDS.find((k) => k.k === kind)!.desc}</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li><button className="text-brand-600 underline" onClick={downloadTemplate}>Excel şablonunu indir</button> ve doldur (ikinci sayfada sütun açıklamaları var).</li>
          <li>Dosyayı yükle: <button className="btn-secondary !py-1" onClick={() => input.current?.click()} disabled={upload.isPending}>{upload.isPending ? 'Okunuyor…' : 'Excel veya CSV seç'}</button>
            <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} /></li>
          <li>Önizlemeyi kontrol et; hatalı satırlar uygulanmaz, geri kalanı "Uygula" ile işlenir.</li>
        </ol>
        {upload.error && <ErrorBox message={(upload.error as Error).message} />}
      </div>

      {preview && (
        <div className="space-y-3">
          <div className="card flex flex-wrap items-center gap-3 text-sm">
            <span>{preview.total} satır</span><Badge tone="ok">{preview.valid} geçerli</Badge>{preview.invalid > 0 && <Badge tone="bad">{preview.invalid} hatalı</Badge>}
            {preview.unknownColumns.length > 0 && <span className="text-amber-700">Tanınmayan sütunlar yok sayıldı: {preview.unknownColumns.join(', ')}</span>}
            <label className="flex items-center gap-1"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Yalnızca hatalılar</label>
            <button className="btn-primary ml-auto" disabled={preview.valid === 0 || apply.isPending} onClick={() => { if (confirm(`${preview.valid} satır uygulanacak. Devam?`)) apply.mutate(); }}>{apply.isPending ? 'Uygulanıyor…' : `${preview.valid} satırı uygula`}</button>
          </div>
          {apply.error && <ErrorBox message={(apply.error as Error).message} />}
          <div className="card overflow-x-auto !p-0">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left uppercase text-slate-500 dark:bg-slate-800/50"><tr><th className="px-2 py-1">Satır</th><th className="px-2 py-1">Durum</th>{columns.map((c) => <th key={c} className="px-2 py-1">{c}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {shown.slice(0, 500).map((r) => (
                  <tr key={r.row} className={r.errors.length ? 'bg-rose-50 dark:bg-rose-950/30' : ''}>
                    <td className="px-2 py-1">{r.row}</td>
                    <td className="px-2 py-1">{r.errors.length ? <span className="text-rose-700">{r.errors.join('; ')}</span> : <Badge tone={r.action === 'update' ? 'info' : 'ok'}>{r.action === 'update' ? 'Güncelle' : 'Ekle'}</Badge>}</td>
                    {columns.map((c) => <td key={c} className="max-w-[220px] truncate px-2 py-1" title={String(r.data[c] ?? '')}>{String(r.data[c] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 500 && <div className="p-2 text-xs text-slate-500">İlk 500 satır gösteriliyor.</div>}
          </div>
        </div>
      )}

      {result && (
        <div className="card space-y-1 text-sm">
          <div className="font-medium">Tamamlandı</div>
          {result.created != null && <div>Yeni ürün: {result.created} · Güncellenen ürün: {result.updated} · Yeni varyant: {result.variantsCreated} · Güncellenen varyant: {result.variantsUpdated}</div>}
          {result.created == null && <div>Güncellenen: {result.updated}</div>}
          {result.errors.length > 0 && <div className="text-rose-700">Hatalar: {result.errors.map((e) => `${e.sku}: ${e.error}`).join(' · ')}</div>}
        </div>
      )}
    </div>
  );
}
