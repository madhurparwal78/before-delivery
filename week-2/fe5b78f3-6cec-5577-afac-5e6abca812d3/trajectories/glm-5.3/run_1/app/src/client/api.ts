// API access: same-origin fetch with JSON, sessions and the business clock.

export interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  offer?: { accept: string; label: string };
  opens_at?: string;
  charged?: boolean;
}

export class ApiFail extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.message);
  }
}

export async function api<T>(method: string, path: string, body?: unknown, opts: { idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('json')) data = await res.json();
  else data = await res.text();
  if (!res.ok) {
    throw new ApiFail(res.status, data as ApiErrorBody);
  }
  return data as T;
}

// ---------- the business clock, read from the server, never the device ----------

let clockBase = 0; // epoch ms of `now` at fetch time
let clockFetchedAt = 0; // performance.now() at fetch time
let clockRate = 1;

export async function fetchClock(): Promise<{ now: string; rate: number }> {
  const c = await api<{ now: string; rate: number }>('GET', '/api/clock');
  clockBase = Date.parse(c.now.replace('+05:30', 'Z'));
  clockFetchedAt = performance.now();
  clockRate = c.rate;
  return c;
}

/** Business now in epoch ms, advanced by a monotonic timer at `rate` business seconds per real second. */
export function businessNowMs(): number {
  return clockBase + (performance.now() - clockFetchedAt) * clockRate;
}

export function businessNowStamp(): string {
  const ms = businessNowMs();
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+05:30`;
}

export function clockRateOf(): number { return clockRate; }
