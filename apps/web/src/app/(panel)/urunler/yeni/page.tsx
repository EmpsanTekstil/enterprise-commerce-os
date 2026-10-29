'use client';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorBox } from '@/components/ui';
import { api } from '@/lib/api';

interface VariantForm { sku: string; barcode: string; color: string; size: string; dimensions: string; weightGrams: string; material: string; costPrice: string; listPrice: string; initialStock: string }
const emptyVariant = (): VariantForm => ({ sku: '', barcode: '', color: '', size: '', dimensions: '', weightGrams: '', material: '', costPrice: '', listPrice: '', initialStock: '0' });
const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

export default function NewProductPage() {
  const router = useRouter();
  const [f, setF] = useState({ name: '', brand: '', model: '', description: '', shortDescription: '', packageContent: '', warrantyMonths: '', originCountry: 'Türkiye', vatRate: '20', status: 'DRAFT' });
  const [specs, setSpecs] = useState<{ k: string; v: string }[]>([{ k: '', v: '' }]);
  const [variants, setVariants] = useState<VariantForm[]>([emptyVariant()]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const setV = (i: number, k: keyof VariantForm) => (e: React.ChangeEvent<HTMLInputElement>) => setVariants(variants.map((v, j) => (j === i ? { ...v, [k]: e.target.value } : v)));

  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/products', {
      method: 'POST',
      body: JSON.stringify({
        name: f.name, brand: f.brand || undefined, model: f.model || undefined, description: f.description || undefined,
        shortDescription: f.shortDescription || undefined, packageContent: f.packageContent || undefined,
        warrantyMonths: num(f.warrantyMonths), originCountry: f.originCountry || undefined, vatRate: num(f.vatRate), status: f.status,
        specs: Object.fromEntries(specs.filter((s) => s.k.trim()).map((s) => [s.k.trim(), s.v])),
        variants: variants.map((v) => ({
          sku: v.sku, barcode: v.barcode || undefined, color: v.color || undefined, size: v.size || undefined, dimensions: v.dimensions || undefined,
          weightGrams: num(v.weightGrams), material: v.material || undefined, costPrice: num(v.costPrice), listPrice: num(v.listPrice), initialStock: num(v.initialStock) ?? 0,
        })),
      }),
    }),
    onSuccess: (p) => router.push(`/urunler/${p.id}`),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="mx-auto max-w-4xl space-y-6">
      <section className="card space-y-3">
        <div className="font-medium">Temel bilgiler</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2"><label className="label">Ürün adı *</label><input className="input" required value={f.name} onChange={set('name')} /></div>
          <div><label className="label">Marka</label><input className="input" value={f.brand} onChange={set('brand')} /></div>
          <div><label className="label">Model</label><input className="input" value={f.model} onChange={set('model')} /></div>
          <div className="md:col-span-2"><label className="label">Kısa açıklama</label><input className="input" maxLength={500} value={f.shortDescription} onChange={set('shortDescription')} /></div>
          <div className="md:col-span-2"><label className="label">Ürün açıklaması</label><textarea className="input min-h-[120px]" value={f.description} onChange={set('description')} /></div>
          <div><label className="label">Paket içeriği</label><input className="input" value={f.packageContent} onChange={set('packageContent')} /></div>
          <div><label className="label">Garanti (ay)</label><input className="input" type="number" min={0} value={f.warrantyMonths} onChange={set('warrantyMonths')} /></div>
          <div><label className="label">Menşei</label><input className="input" value={f.originCountry} onChange={set('originCountry')} /></div>
          <div><label className="label">KDV (%)</label><input className="input" type="number" min={0} step="0.01" value={f.vatRate} onChange={set('vatRate')} /></div>
          <div><label className="label">Durum</label><select className="input" value={f.status} onChange={set('status')}><option value="DRAFT">Taslak</option><option value="ACTIVE">Aktif</option></select></div>
        </div>
      </section>

      <section className="card space-y-3">
        <div className="flex items-center"><div className="font-medium">Teknik özellikler</div><button type="button" className="btn-secondary ml-auto" onClick={() => setSpecs([...specs, { k: '', v: '' }])}>Özellik ekle</button></div>
        {specs.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <input className="input" placeholder="Özellik (örn. Malzeme)" value={s.k} onChange={(e) => setSpecs(specs.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
            <input className="input" placeholder="Değer (örn. %100 Pamuk)" value={s.v} onChange={(e) => setSpecs(specs.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
            <button type="button" className="btn-secondary" onClick={() => setSpecs(specs.filter((_, j) => j !== i))}>Sil</button>
          </div>
        ))}
      </section>

      <section className="card space-y-3">
        <div className="flex items-center"><div className="font-medium">Varyantlar (SKU / barkod / fiyat / stok)</div><button type="button" className="btn-secondary ml-auto" onClick={() => setVariants([...variants, emptyVariant()])}>Varyant ekle</button></div>
        {variants.map((v, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="grid gap-2 md:grid-cols-4">
              <div><label className="label">SKU *</label><input className="input" required value={v.sku} onChange={setV(i, 'sku')} /></div>
              <div><label className="label">Barkod</label><input className="input" value={v.barcode} onChange={setV(i, 'barcode')} /></div>
              <div><label className="label">Renk</label><input className="input" value={v.color} onChange={setV(i, 'color')} /></div>
              <div><label className="label">Beden</label><input className="input" value={v.size} onChange={setV(i, 'size')} /></div>
              <div><label className="label">Ölçü</label><input className="input" placeholder="30x20x10 cm" value={v.dimensions} onChange={setV(i, 'dimensions')} /></div>
              <div><label className="label">Ağırlık (gram)</label><input className="input" type="number" min={0} value={v.weightGrams} onChange={setV(i, 'weightGrams')} /></div>
              <div><label className="label">Malzeme</label><input className="input" value={v.material} onChange={setV(i, 'material')} /></div>
              <div><label className="label">Alış maliyeti (₺)</label><input className="input" type="number" min={0} step="0.01" value={v.costPrice} onChange={setV(i, 'costPrice')} /></div>
              <div><label className="label">Satış fiyatı (₺)</label><input className="input" type="number" min={0} step="0.01" value={v.listPrice} onChange={setV(i, 'listPrice')} /></div>
              <div><label className="label">Açılış stoğu</label><input className="input" type="number" min={0} value={v.initialStock} onChange={setV(i, 'initialStock')} /></div>
            </div>
            {variants.length > 1 && <button type="button" className="btn-danger mt-2" onClick={() => setVariants(variants.filter((_, j) => j !== i))}>Varyantı sil</button>}
          </div>
        ))}
      </section>

      <section className="card text-sm text-slate-500">Ürün görselleri ve pazaryerine özel bilgiler, ürün kaydedildikten sonra ürün detay sayfasından eklenir (Faz 3).</section>

      {m.error && <ErrorBox message={(m.error as Error).message} />}
      <div className="flex gap-2"><button className="btn-primary" disabled={m.isPending}>{m.isPending ? 'Kaydediliyor…' : 'Ürünü Kaydet'}</button><button type="button" className="btn-secondary" onClick={() => router.back()}>Vazgeç</button></div>
    </form>
  );
}
