'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, ErrorBox } from '@/components/ui';
import { api } from '@/lib/api';

interface Trigger { key: string; name: string; description: string; conditionHint?: string }
interface Rule { id: string; name: string; trigger: string; conditionJson: Record<string, unknown>; isEnabled: boolean; lastFiredAt: string | null }

export default function AutomationsPage() {
  const qc = useQueryClient();
  const triggers = useQuery({ queryKey: ['triggers'], queryFn: () => api<Trigger[]>('/automations/triggers') });
  const rules = useQuery({ queryKey: ['automations'], queryFn: () => api<Rule[]>('/automations') });
  const [form, setForm] = useState({ name: '', trigger: '', condition: '{}' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['automations'] });
  const save = useMutation({ mutationFn: () => api('/automations', { method: 'POST', body: JSON.stringify({ name: form.name, trigger: form.trigger, condition: JSON.parse(form.condition || '{}') }) }), onSuccess: () => { setForm({ name: '', trigger: '', condition: '{}' }); refresh(); } });
  const toggle = useMutation({ mutationFn: (p: { id: string; isEnabled: boolean }) => api(`/automations/${p.id}/toggle`, { method: 'POST', body: JSON.stringify({ isEnabled: p.isEnabled }) }), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api(`/automations/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const defaults = useMutation({ mutationFn: () => api<{ created: number }>('/automations/install-defaults', { method: 'POST' }), onSuccess: refresh });
  const evaluate = useMutation({ mutationFn: () => api<{ evaluated: number; fired: number }>('/automations/evaluate', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const tmap = new Map(triggers.data?.map((t) => [t.key, t]));
  const err = (save.error ?? evaluate.error) as Error | null;
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-2 text-sm"><span>Kurallar her 5 dakikada bir otomatik değerlendirilir ve bildirim üretir.</span><button className="btn-secondary ml-auto" onClick={() => defaults.mutate()}>Varsayılan kuralları ekle</button><button className="btn-secondary" disabled={evaluate.isPending} onClick={() => evaluate.mutate()}>Şimdi değerlendir</button>{evaluate.data && <span className="text-slate-500">{evaluate.data.fired}/{evaluate.data.evaluated} kural tetiklendi</span>}</div>
      {err && <ErrorBox message={err.message} />}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card space-y-2">
          <div className="font-medium">Yeni kural</div>
          <input className="input" placeholder="Kural adı" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="input" value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value, name: form.name || tmap.get(e.target.value)?.name || '' })}><option value="">Tetikleyici seçin</option>{triggers.data?.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select>
          {form.trigger && <div className="text-xs text-slate-500">{tmap.get(form.trigger)?.description}</div>}
          {tmap.get(form.trigger)?.conditionHint && <div><label className="label">Koşul (JSON) — örn. {tmap.get(form.trigger)!.conditionHint}</label><input className="input font-mono text-xs" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} /></div>}
          <button className="btn-primary" disabled={!form.name || !form.trigger || save.isPending} onClick={() => save.mutate()}>Kaydet</button>
        </section>
        <section className="card lg:col-span-2">
          <div className="mb-2 font-medium">Kurallar</div>
          {rules.data?.length === 0 && <div className="text-sm text-slate-500">Henüz kural yok. "Varsayılan kuralları ekle" ile başlayın.</div>}
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">{rules.data?.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
              <label className="flex items-center gap-2"><input type="checkbox" checked={r.isEnabled} onChange={(e) => toggle.mutate({ id: r.id, isEnabled: e.target.checked })} /><span className="font-medium">{r.name}</span></label>
              <span className="text-slate-500">{tmap.get(r.trigger)?.name ?? r.trigger}</span>
              {Object.keys(r.conditionJson ?? {}).length > 0 && <code className="text-xs text-slate-500">{JSON.stringify(r.conditionJson)}</code>}
              {r.lastFiredAt ? <Badge tone="info">Son: {new Date(r.lastFiredAt).toLocaleString('tr-TR')}</Badge> : <Badge tone="neutral">Henüz tetiklenmedi</Badge>}
              <button className="ml-auto text-xs text-rose-600 underline" onClick={() => { if (confirm('Kural silinsin mi?')) del.mutate(r.id); }}>Sil</button>
            </li>))}</ul>
        </section>
      </div>
    </div>
  );
}
