'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, ErrorBox } from '@/components/ui';
import { api } from '@/lib/api';

interface User { id: string; email: string; fullName: string; isActive: boolean; lastLoginAt: string | null; userRoles: { role: { id: string; key: string; name: string } }[] }
interface Role { id: string; key: string; name: string; rolePermissions: { permission: { key: string; description: string } }[]; _count: { userRoles: number } }
interface Perm { key: string; description: string }

export default function UsersPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'kullanicilar' | 'roller'>('kullanicilar');
  const [form, setForm] = useState({ email: '', fullName: '', roleIds: [] as string[] });
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const [editRole, setEditRole] = useState<Role | null>(null); const [keys, setKeys] = useState<string[]>([]);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });
  const perms = useQuery({ queryKey: ['permissions'], queryFn: () => api<Perm[]>('/permissions') });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['roles'] }); };
  const create = useMutation({ mutationFn: () => api<{ email: string; tempPassword?: string }>('/users', { method: 'POST', body: JSON.stringify(form) }), onSuccess: (r) => { setTemp(r.tempPassword ? { email: r.email, password: r.tempPassword } : null); setForm({ email: '', fullName: '', roleIds: [] }); refresh(); } });
  const update = useMutation({ mutationFn: (p: { id: string; isActive?: boolean; roleIds?: string[] }) => api(`/users/${p.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: p.isActive, roleIds: p.roleIds }) }), onSuccess: refresh });
  const reset = useMutation({ mutationFn: (u: User) => api<{ tempPassword: string }>(`/users/${u.id}/reset-password`, { method: 'POST' }), onSuccess: (r, u) => setTemp({ email: u.email, password: r.tempPassword }) });
  const savePerms = useMutation({ mutationFn: () => api(`/roles/${editRole!.id}/permissions`, { method: 'PUT', body: JSON.stringify({ keys }) }), onSuccess: () => { setEditRole(null); refresh(); } });
  const err = (create.error ?? update.error ?? reset.error ?? savePerms.error) as Error | null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2"><button className={tab === 'kullanicilar' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('kullanicilar')}>Kullanıcılar</button><button className={tab === 'roller' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('roller')}>Roller ve yetkiler</button></div>
      {err && <ErrorBox message={err.message} />}
      {temp && <div className="card border-amber-300 text-sm"><b>{temp.email}</b> için geçici şifre: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{temp.password}</code> — bir daha gösterilmez; kullanıcıya iletin, ilk girişte değiştirsin. <button className="ml-2 text-brand-600 underline" onClick={() => setTemp(null)}>Kapat</button></div>}

      {tab === 'kullanicilar' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="card space-y-2">
            <div className="font-medium">Yeni kullanıcı</div>
            <input className="input" placeholder="Ad Soyad" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            <input className="input" type="email" placeholder="E-posta" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <div className="space-y-1 text-sm">{roles.data?.map((r) => <label key={r.id} className="flex items-center gap-2"><input type="checkbox" checked={form.roleIds.includes(r.id)} onChange={(e) => setForm({ ...form, roleIds: e.target.checked ? [...form.roleIds, r.id] : form.roleIds.filter((x) => x !== r.id) })} />{r.name}</label>)}</div>
            <button className="btn-primary" disabled={!form.email || !form.fullName || !form.roleIds.length || create.isPending} onClick={() => create.mutate()}>Oluştur</button>
          </section>
          <section className="card lg:col-span-2 overflow-x-auto !p-0"><table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50"><tr><th className="px-3 py-2">Kullanıcı</th><th className="px-3 py-2">Roller</th><th className="px-3 py-2">Son giriş</th><th className="px-3 py-2">Durum</th><th className="px-3 py-2"></th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{users.data?.map((u) => (
              <tr key={u.id}><td className="px-3 py-2"><div className="font-medium">{u.fullName}</div><div className="text-xs text-slate-500">{u.email}</div></td>
                <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{roles.data?.map((r) => { const on = u.userRoles.some((x) => x.role.id === r.id); return <button key={r.id} className={`badge ${on ? 'bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`} onClick={() => update.mutate({ id: u.id, roleIds: on ? u.userRoles.filter((x) => x.role.id !== r.id).map((x) => x.role.id) : [...u.userRoles.map((x) => x.role.id), r.id] })}>{r.name}</button>; })}</div></td>
                <td className="px-3 py-2 text-xs">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('tr-TR') : '—'}</td>
                <td className="px-3 py-2">{u.isActive ? <Badge tone="ok">Aktif</Badge> : <Badge tone="neutral">Pasif</Badge>}</td>
                <td className="px-3 py-2 text-xs"><button className="text-brand-600 underline" onClick={() => { if (confirm('Yeni geçici şifre üretilsin mi?')) reset.mutate(u); }}>Şifre sıfırla</button> · <button className="text-brand-600 underline" onClick={() => update.mutate({ id: u.id, isActive: !u.isActive })}>{u.isActive ? 'Pasifleştir' : 'Aktifleştir'}</button></td></tr>))}</tbody></table></section>
        </div>
      )}

      {tab === 'roller' && (
        <div className="grid gap-3 md:grid-cols-2">
          {roles.data?.map((r) => (
            <div key={r.id} className="card space-y-2 text-sm">
              <div className="flex items-center gap-2"><span className="font-medium">{r.name}</span><span className="text-xs text-slate-500">{r._count.userRoles} kullanıcı</span>{r.key === 'admin' ? <Badge tone="info">Tüm yetkiler</Badge> : <button className="ml-auto text-xs text-brand-600 underline" onClick={() => { setEditRole(r); setKeys(r.rolePermissions.map((p) => p.permission.key)); }}>Yetkileri düzenle</button>}</div>
              <div className="flex flex-wrap gap-1">{r.rolePermissions.map((p) => <Badge key={p.permission.key} tone="neutral">{p.permission.description}</Badge>)}</div>
            </div>))}
        </div>
      )}

      {editRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditRole(null)}>
          <div className="card max-h-[85vh] w-full max-w-lg overflow-y-auto space-y-2 text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="font-medium">{editRole.name} — yetkiler</div>
            {perms.data?.map((p) => <label key={p.key} className="flex items-center gap-2"><input type="checkbox" checked={keys.includes(p.key)} onChange={(e) => setKeys(e.target.checked ? [...keys, p.key] : keys.filter((k) => k !== p.key))} /><span>{p.description}</span><code className="ml-auto text-xs text-slate-400">{p.key}</code></label>)}
            <div className="flex gap-2 pt-2"><button className="btn-primary" disabled={savePerms.isPending} onClick={() => savePerms.mutate()}>Kaydet</button><button className="btn-secondary" onClick={() => setEditRole(null)}>Vazgeç</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
