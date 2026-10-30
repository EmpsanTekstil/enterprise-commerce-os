'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, ErrorBox } from '@/components/ui';
import { api } from '@/lib/api';

interface Audit { id: string; action: string; entityType: string; entityId: string | null; beforeJson: unknown; afterJson: unknown; createdAt: string; user: { fullName: string; email: string } | null }
interface Health { status: string; database: string; time: string }
interface Retention { piiMaskAfterDays: number | null; rawPurgeAfterDays: number | null; piiLastRunAt: string | null }
interface Preview { cutoffMask: string | null; cutoffRaw: string | null; orders: number; returns: number; questions: number; reviews: number; raw: number }
interface RunResult { ranAt: string; orders: number; returns: number; questions: number; reviews: number; raw: number }

export default function SettingsPage() {
  const [tab, setTab] = useState<'hesap' | 'sistem' | 'kvkk' | 'denetim'>('hesap');
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [entity, setEntity] = useState('');
  const [ret, setRet] = useState<{ mask: string; raw: string } | null>(null);
  const retention = useQuery({ queryKey: ['retention'], queryFn: () => api<Retention>('/privacy/retention'), enabled: tab === 'kvkk' });
  const preview = useQuery({ queryKey: ['retention-preview'], queryFn: () => api<Preview>('/privacy/retention/preview'), enabled: tab === 'kvkk' });
  const form = ret ?? { mask: retention.data?.piiMaskAfterDays?.toString() ?? '', raw: retention.data?.rawPurgeAfterDays?.toString() ?? '' };
  const saveRet = useMutation({ mutationFn: () => api('/privacy/retention', { method: 'PUT', body: JSON.stringify({ piiMaskAfterDays: form.mask ? Number(form.mask) : null, rawPurgeAfterDays: form.raw ? Number(form.raw) : null }) }), onSuccess: () => { setRet(null); retention.refetch(); preview.refetch(); } });
  const runRet = useMutation({ mutationFn: () => api<RunResult>('/privacy/retention/run', { method: 'POST' }), onSuccess: () => { retention.refetch(); preview.refetch(); } });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/health'), refetchInterval: 30_000 });
  const syncMode = useQuery({ queryKey: ['sync-mode'], queryFn: () => api<{ mode: string }>('/sync/mode') });
  const ai = useQuery({ queryKey: ['ai-status'], queryFn: () => api<{ enabled: boolean; model: string }>('/ai/status') });
  const audit = useQuery({ queryKey: ['audit', entity], queryFn: () => api<Audit[]>(`/audit-log${entity ? `?entityType=${entity}` : ''}`), enabled: tab === 'denetim' });
  const change = useMutation({ mutationFn: () => api('/users/me/password', { method: 'POST', body: JSON.stringify({ current: pw.current, next: pw.next }) }), onSuccess: () => setPw({ current: '', next: '', again: '' }) });
  return (
    <div className="space-y-4">
      <div className="flex gap-2">{([['hesap', 'Hesabım'], ['sistem', 'Sistem durumu'], ['kvkk', 'KVKK veri saklama'], ['denetim', 'Denetim kaydı']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'kvkk' && (
        <div className="grid gap-3 md:grid-cols-2">
          <section className="card space-y-2 text-sm">
            <div className="font-medium">Saklama süreleri</div>
            <p className="text-xs text-slate-500">Boş bırakılan alan kapalıdır. Süresi dolan kayıtlarda müşteri adı, e-posta, telefon ve adres kalıcı olarak maskelenir; sipariş tutarları ve raporlar korunur. İş günde bir kez otomatik çalışır.</p>
            <div><label className="label">Müşteri bilgisi maskeleme (gün)</label><input className="input w-40" type="number" min={1} max={3650} placeholder="örn. 730" value={form.mask} onChange={(e) => setRet({ ...form, mask: e.target.value })} /></div>
            <div><label className="label">Kanal ham verisini silme (gün)</label><input className="input w-40" type="number" min={1} max={3650} placeholder="örn. 365" value={form.raw} onChange={(e) => setRet({ ...form, raw: e.target.value })} /></div>
            {saveRet.error && <ErrorBox message={(saveRet.error as Error).message} />}
            <button className="btn-primary" disabled={!ret || saveRet.isPending} onClick={() => saveRet.mutate()}>Kaydet</button>
            <div className="text-xs text-slate-500">Son çalışma: {retention.data?.piiLastRunAt ? new Date(retention.data.piiLastRunAt).toLocaleString('tr-TR') : 'henüz yok'}</div>
          </section>
          <section className="card space-y-2 text-sm">
            <div className="font-medium">Şimdi çalıştırılsa etkilenecek kayıtlar</div>
            {preview.data ? (
              <ul className="space-y-1">
                <li>Sipariş: <b>{preview.data.orders}</b> · İade: <b>{preview.data.returns}</b> · Soru: <b>{preview.data.questions}</b> · Yorum: <b>{preview.data.reviews}</b></li>
                <li>Ham veri silinecek kayıt: <b>{preview.data.raw}</b></li>
                <li className="text-xs text-slate-500">Maskeleme eşiği: {preview.data.cutoffMask ? new Date(preview.data.cutoffMask).toLocaleDateString('tr-TR') : 'kapalı'} · Ham veri eşiği: {preview.data.cutoffRaw ? new Date(preview.data.cutoffRaw).toLocaleDateString('tr-TR') : 'kapalı'}</li>
              </ul>
            ) : <div className="text-slate-500">Yükleniyor…</div>}
            {runRet.error && <ErrorBox message={(runRet.error as Error).message} />}
            {runRet.data && <div className="text-xs text-emerald-600">Çalıştı: {runRet.data.orders} sipariş, {runRet.data.returns} iade, {runRet.data.questions} soru, {runRet.data.reviews} yorum maskelendi; {runRet.data.raw} ham veri silindi.</div>}
            <button className="btn-secondary" disabled={runRet.isPending || !(preview.data && (preview.data.orders + preview.data.returns + preview.data.questions + preview.data.reviews + preview.data.raw) > 0)} onClick={() => { if (confirm('Maskeleme geri alınamaz. Devam?')) runRet.mutate(); }}>Şimdi çalıştır</button>
          </section>
        </div>
      )}
      {tab === 'hesap' && (
        <section className="card max-w-md space-y-2">
          <div className="font-medium">Şifre değiştir</div>
          <input className="input" type="password" placeholder="Mevcut şifre" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
          <input className="input" type="password" placeholder="Yeni şifre (en az 8 karakter)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
          <input className="input" type="password" placeholder="Yeni şifre (tekrar)" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} autoComplete="new-password" />
          {change.error && <ErrorBox message={(change.error as Error).message} />}{change.isSuccess && <div className="text-sm text-emerald-600">Şifre değiştirildi.</div>}
          <button className="btn-primary" disabled={!pw.current || pw.next.length < 8 || pw.next !== pw.again || change.isPending} onClick={() => change.mutate()}>Kaydet</button>
        </section>
      )}
      {tab === 'sistem' && (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="card"><div className="text-xs text-slate-500">API / Veritabanı</div><div className="mt-1">{health.data ? <Badge tone={health.data.status === 'ok' ? 'ok' : 'bad'}>{health.data.status === 'ok' ? 'Çalışıyor' : health.data.database}</Badge> : <Badge tone="bad">Ulaşılamıyor</Badge>}</div></div>
          <div className="card"><div className="text-xs text-slate-500">Arka plan işleri</div><div className="mt-1">{syncMode.data?.mode === 'redis' ? <Badge tone="ok">Redis kuyruğu (yeniden denemeli)</Badge> : <Badge tone="warn">Aynı süreçte (Redis yok)</Badge>}</div><div className="mt-1 text-xs text-slate-500">Üretimde REDIS_URL tanımlayın.</div></div>
          <div className="card"><div className="text-xs text-slate-500">Yapay zekâ</div><div className="mt-1">{ai.data?.enabled ? <Badge tone="ok">Açık · {ai.data.model}</Badge> : <Badge tone="warn">Kapalı (ANTHROPIC_API_KEY yok)</Badge>}</div></div>
          <div className="card md:col-span-3 text-sm text-slate-600 dark:text-slate-300">
            <div className="mb-1 font-medium">Canlıya alma kontrol listesi</div>
            <ul className="list-disc space-y-1 pl-5">
              <li><code>JWT_SECRET</code> ve <code>CREDENTIALS_ENCRYPTION_KEY</code> rastgele ve yalnızca sunucuda; <code>.env</code> depoya girmez.</li>
              <li>Uygulama HTTPS arkasında (ters vekil: Caddy/Nginx); <code>PUBLIC_API_URL</code> ve <code>CORS_ORIGIN</code> gerçek alan adı.</li>
              <li>Görseller için S3/MinIO + herkese açık adres (<code>S3_PUBLIC_URL</code>); yerel disk yalnızca geliştirme.</li>
              <li>PostgreSQL günlük yedek (<code>pg_dump</code>) ve yedekten geri dönüş denemesi.</li>
              <li>Redis açık; <code>SYNC_INTERVAL_MINUTES</code> kanal limitlerine uygun.</li>
              <li>Yönetici dışındaki personel için ayrı kullanıcı ve en dar rol.</li>
            </ul>
          </div>
        </div>
      )}
      {tab === 'denetim' && (
        <div className="space-y-2">
          <select className="input max-w-xs" value={entity} onChange={(e) => setEntity(e.target.value)}><option value="">Tüm kayıtlar</option>{['User', 'Role', 'Product', 'Listing', 'ChannelAccount', 'Order', 'Return', 'PricingRule', 'PriceProposal', 'CustomerQuestion', 'ProductReview', 'InventoryBalance', 'AutomationRule'].map((e) => <option key={e}>{e}</option>)}</select>
          <div className="card overflow-x-auto !p-0"><table className="w-full text-xs"><thead className="bg-slate-50 text-left uppercase text-slate-500 dark:bg-slate-800/50"><tr><th className="px-3 py-2">Zaman</th><th className="px-3 py-2">Kullanıcı</th><th className="px-3 py-2">İşlem</th><th className="px-3 py-2">Nesne</th><th className="px-3 py-2">Önce → Sonra</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{audit.data?.map((a) => <tr key={a.id}><td className="px-3 py-2 whitespace-nowrap">{new Date(a.createdAt).toLocaleString('tr-TR')}</td><td className="px-3 py-2">{a.user?.fullName ?? 'Sistem'}</td><td className="px-3 py-2 font-mono">{a.action}</td><td className="px-3 py-2">{a.entityType}<div className="font-mono text-slate-400">{a.entityId?.slice(0, 8)}</div></td><td className="max-w-md truncate px-3 py-2 font-mono text-slate-500" title={`${JSON.stringify(a.beforeJson)} → ${JSON.stringify(a.afterJson)}`}>{a.beforeJson ? JSON.stringify(a.beforeJson).slice(0, 60) : '—'} → {a.afterJson ? JSON.stringify(a.afterJson).slice(0, 80) : '—'}</td></tr>)}</tbody></table></div>
        </div>
      )}
    </div>
  );
}
