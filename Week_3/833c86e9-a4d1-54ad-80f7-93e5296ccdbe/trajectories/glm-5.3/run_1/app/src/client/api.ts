/** API client with pending tracking, cookies and error normalisation. */

let pending = 0;
const body = () => document.body;

export function beginPending(): void {
  pending++;
  body().dataset.pending = String(pending);
}
export function endPending(): void {
  pending = Math.max(0, pending - 1);
  body().dataset.pending = String(pending);
}

export type ApiFailure = {
  ok: false;
  status: number;
  data: Record<string, unknown>;
};

export type ApiSuccess<T> = { ok: true; status: number; data: T };

export async function api<T>(path: string, init: RequestInit = {}): Promise<ApiSuccess<T> | ApiFailure> {
  beginPending();
  try {
    const initHeaders: Record<string, string> =
      typeof init.headers === "undefined" ? {} :
      Array.isArray(init.headers) || init.headers instanceof Headers
        ? Object.fromEntries(new Headers(init.headers).entries())
        : init.headers;
    const headers: Record<string, string> = init.body
      ? { "Content-Type": "application/json", ...initHeaders }
      : initHeaders;
    const res = await fetch(path, { ...init, headers });
    const ct = res.headers.get("content-type") ?? "";
    const data: unknown = ct.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) return { ok: false, status: res.status, data: (data ?? {}) as Record<string, unknown> };
    return { ok: true, status: res.status, data: data as T };
  } finally {
    endPending();
  }
}

export function query(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

export function idempotencyKey(): string {
  return crypto.randomUUID();
}
