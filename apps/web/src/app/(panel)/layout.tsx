'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { getToken } from '@/lib/api';
import { NAV } from '@/lib/nav';

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => { if (!getToken()) router.replace('/giris'); else setReady(true); }, [router]);
  const title = [...NAV].sort((a, b) => b.href.length - a.href.length).find((n) => (n.href === '/' ? path === '/' : path.startsWith(n.href)))?.label ?? '';
  if (!ready) return null;
  return (
    <div className="flex min-h-screen">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setOpen(true)} title={title} />
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
