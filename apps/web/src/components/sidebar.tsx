'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from '@/lib/nav';
import { cn } from '@/lib/utils';

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const path = usePathname();
  const groups = [...new Set(NAV.map((n) => n.group))];
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onClose} />}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto border-r border-slate-200 bg-white p-3 transition-transform dark:border-slate-800 dark:bg-slate-900 lg:static lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}>
        <div className="mb-4 px-2 text-base font-semibold tracking-tight">Enterprise Commerce OS</div>
        {groups.map((g) => (
          <div key={g} className="mb-3">
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g}</div>
            {NAV.filter((n) => n.group === g).map((n) => {
              const nested = NAV.filter((x) => x.href !== n.href && x.href.startsWith(n.href + '/'));
              const active = n.href === '/' ? path === '/' : (path === n.href || path.startsWith(n.href + '/')) && !nested.some((x) => path === x.href || path.startsWith(x.href + '/')) && (n.href !== '/urunler' || path === '/urunler' || /^\/urunler\/(?!yeni)/.test(path));
              return (
                <Link key={n.href} href={n.href} onClick={onClose} className={cn(
                  'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm',
                  active ? 'bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )}>
                  <n.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{n.label}</span>
                  {!n.ready && <span className="ml-auto text-[10px] text-slate-400">yakında</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </aside>
    </>
  );
}
