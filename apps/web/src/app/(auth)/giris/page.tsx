'use client';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { api, setSession } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const r = await api<{ accessToken: string; user: unknown }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      setSession(r.accessToken, r.user);
      router.replace('/');
    } catch (err) {
      setError((err as Error).message);
    } finally { setLoading(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
        <div>
          <div className="text-lg font-semibold">Enterprise Commerce OS</div>
          <div className="text-sm text-slate-500">Yönetim paneline giriş yapın</div>
        </div>
        <div><label className="label">E-posta</label><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></div>
        <div><label className="label">Şifre</label><input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
        {error && <div className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">{error}</div>}
        <button className="btn-primary w-full" disabled={loading}>{loading ? 'Giriş yapılıyor…' : 'Giriş Yap'}</button>
      </form>
    </main>
  );
}
