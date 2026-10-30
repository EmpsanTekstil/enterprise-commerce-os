'use client';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'eco.token';
const USER_KEY = 'eco.user';

export function getToken() { return typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY); }
export function setSession(token: string, user: unknown) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); }
export function clearSession() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
export function getUser<T = { fullName: string; email: string; roles: string[]; permissions: string[] }>(): T | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as T) : null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api/v1${path}`, { ...init, headers });
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
    clearSession();
    window.location.href = '/giris';
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message ?? `Hata ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const fmtTRY = (n: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);
export const fmtNum = (n: number) => new Intl.NumberFormat('tr-TR').format(n);
