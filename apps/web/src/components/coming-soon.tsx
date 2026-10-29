'use client';
import { usePathname } from 'next/navigation';
import { NAV } from '@/lib/nav';

const PHASE: Record<string, string> = {
  '/toplu-islemler': 'Faz 3', '/yayinlar': 'Faz 4', '/siparisler': 'Faz 6', '/stok': 'Faz 6', '/kargo': 'Faz 6', '/fiyat': 'Faz 6',
  '/reklam': 'Faz 7', '/sorular': 'Faz 8', '/yorumlar': 'Faz 8', '/gelen-kutusu': 'Faz 8', '/yapay-zeka': 'Faz 9', '/finans': 'Faz 9',
  '/raporlar': 'Faz 9', '/otomasyonlar': 'Faz 9', '/kullanicilar': 'Faz 2', '/ayarlar': 'Faz 10',
};

export function ComingSoon() {
  const path = usePathname();
  const item = [...NAV].sort((a, b) => b.href.length - a.href.length).find((n) => path.startsWith(n.href));
  const phase = Object.entries(PHASE).sort((a, b) => b[0].length - a[0].length).find(([k]) => path.startsWith(k))?.[1];
  return (
    <div className="card py-12 text-center">
      <div className="text-lg font-medium">{item?.label}</div>
      <div className="mt-1 text-sm text-slate-500">Bu modül henüz geliştirilmedi{phase ? ` (planlanan: ${phase})` : ''}. Sahte veri gösterilmez.</div>
    </div>
  );
}
