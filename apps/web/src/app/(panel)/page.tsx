'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, ErrorBox, StatCard } from '@/components/ui';
import { api, fmtNum, fmtTRY } from '@/lib/api';

interface Summary {
  sales: Record<'today' | 'week' | 'month' | 'inRange', { revenue: number; profit: number; count: number }>;
  orders: { pending: number; toShip: number; cancelled: number; returned: number; total: number };
  products: { active: number; lowStockAlerts: number };
  ads: { spend: number; sales: number; orders: number };
  support: { openQuestions: number; newReviews: number };
  integrations: { accounts: { id: string; label: string; status: string; lastSyncAt: string | null; lastError: string | null; channel: { code: string; name: string } }[]; failedSyncJobs: number };
}

const RANGES = [{ k: 7, l: 'Son 7 gün' }, { k: 30, l: 'Son 30 gün' }, { k: 90, l: 'Son 90 gün' }];

export default function DashboardPage() {
  const [days, setDays] = useState(30);
  const from = new Date(Date.now() - (days - 1) * 86_400_000); from.setHours(0, 0, 0, 0);
  const { data, error, isLoading } = useQuery({
    queryKey: ['dashboard', days],
    queryFn: () => api<Summary>(`/dashboard/summary?from=${from.toISOString()}`),
  });
  if (error) return <ErrorBox message={(error as Error).message} />;
  if (isLoading || !data) return <div className="text-sm text-slate-500">Yükleniyor…</div>;
  const statusTone = (s: string) => (s === 'CONNECTED' ? 'ok' : s === 'ERROR' ? 'bad' : 'warn');
  const statusLabel: Record<string, string> = { CONNECTED: 'Bağlı', ERROR: 'Hata', NOT_CONFIGURED: 'Test edilmedi', DISABLED: 'Kapalı' };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => <button key={r.k} onClick={() => setDays(r.k)} className={r.k === days ? 'btn-primary' : 'btn-secondary'}>{r.l}</button>)}
      </div>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Bugünkü satış" value={fmtTRY(data.sales.today.revenue)} hint={`${data.sales.today.count} sipariş`} />
        <StatCard label="Haftalık ciro" value={fmtTRY(data.sales.week.revenue)} />
        <StatCard label="Aylık ciro" value={fmtTRY(data.sales.month.revenue)} />
        <StatCard label="Tahmini net kâr" value={fmtTRY(data.sales.inRange.profit)} hint="Seçili aralık" tone="ok" />
      </section>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Toplam sipariş" value={fmtNum(data.orders.total)} />
        <StatCard label="Bekleyen sipariş" value={fmtNum(data.orders.pending)} tone={data.orders.pending ? 'warn' : undefined} />
        <StatCard label="Kargolanacak" value={fmtNum(data.orders.toShip)} />
        <StatCard label="İptal / İade" value={`${fmtNum(data.orders.cancelled)} / ${fmtNum(data.orders.returned)}`} />
      </section>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Aktif ürün" value={fmtNum(data.products.active)} />
        <StatCard label="Stok uyarısı" value={fmtNum(data.products.lowStockAlerts)} tone={data.products.lowStockAlerts ? 'bad' : undefined} />
        <StatCard label="Reklam harcaması" value={fmtTRY(data.ads.spend)} />
        <StatCard label="Reklam kaynaklı satış" value={fmtTRY(data.ads.sales)} hint={`${data.ads.orders} sipariş`} />
      </section>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Bekleyen müşteri sorusu" value={fmtNum(data.support.openQuestions)} tone={data.support.openQuestions ? 'warn' : undefined} />
        <StatCard label="Yeni yorum" value={fmtNum(data.support.newReviews)} />
        <StatCard label="Senkronizasyon hatası" value={fmtNum(data.integrations.failedSyncJobs)} tone={data.integrations.failedSyncJobs ? 'bad' : undefined} />
        <StatCard label="Bağlı hesap" value={`${data.integrations.accounts.filter((a) => a.status === 'CONNECTED').length} / ${data.integrations.accounts.length}`} />
      </section>
      <section className="card">
        <div className="mb-2 font-medium">API bağlantı durumları</div>
        {data.integrations.accounts.length === 0 ? (
          <div className="text-sm text-slate-500">Henüz kanal hesabı eklenmedi. Entegrasyonlar sayfasından ekleyebilirsiniz.</div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.integrations.accounts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="font-medium">{a.channel.name}</span><span className="text-slate-500">{a.label}</span>
                <span className="ml-auto"><Badge tone={statusTone(a.status)}>{statusLabel[a.status] ?? a.status}</Badge></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
