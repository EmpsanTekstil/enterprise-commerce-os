/**
 * Küçük, bağımlılıksız HTTP istemcisi (Node 18+ fetch).
 * Zaman aşımı, yeniden deneme (429/5xx) ve hata ayıklama için istek kimliği içerir.
 */
export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
}

export class HttpError extends Error {
  constructor(public status: number, public body: string, public url: string) {
    super(`HTTP ${status} ${url}: ${body.slice(0, 300)}`);
    this.name = 'HttpError';
  }
}

export async function httpRequest<T = unknown>(req: HttpRequest): Promise<T> {
  const retries = req.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 30_000);
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(req.headers ?? {}) },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          continue;
        }
        throw new HttpError(res.status, text, req.url);
      }
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError) throw e;
      if (attempt >= retries) throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
