import { cn } from '@/lib/utils';

export function StatCard({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="card">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold', tone === 'bad' && 'text-rose-600', tone === 'warn' && 'text-amber-600', tone === 'ok' && 'text-emerald-600')}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'info' }) {
  const map = {
    neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    bad: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    info: 'bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100',
  };
  return <span className={cn('badge', map[tone])}>{children}</span>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return <div className="card py-10 text-center"><div className="font-medium">{title}</div>{hint && <div className="mt-1 text-sm text-slate-500">{hint}</div>}</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">{message}</div>;
}
