'use client';
import { LogOut, Menu, Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clearSession, getUser } from '@/lib/api';
import { NotificationsBell } from './notifications-bell';

export function Topbar({ onMenu, title }: { onMenu: () => void; title: string }) {
  const router = useRouter();
  const [dark, setDark] = useState(false);
  const [user, setUser] = useState<{ fullName: string; email: string } | null>(null);
  useEffect(() => { setDark(document.documentElement.classList.contains('dark')); setUser(getUser()); }, []);
  function toggleTheme() {
    const next = !dark; setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('eco.theme', next ? 'dark' : 'light');
  }
  return (
    <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
      <button className="lg:hidden" onClick={onMenu} aria-label="Menü"><Menu className="h-5 w-5" /></button>
      <h1 className="text-base font-semibold">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        <NotificationsBell />
        <button className="btn-secondary !px-2" onClick={toggleTheme} aria-label="Tema">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
        <span className="hidden text-sm text-slate-500 sm:inline">{user?.fullName}</span>
        <button className="btn-secondary !px-2" onClick={() => { clearSession(); router.replace('/giris'); }} aria-label="Çıkış"><LogOut className="h-4 w-4" /></button>
      </div>
    </header>
  );
}
