// Shared browser-side helpers: one request path, one clock estimate, one format.

export interface Me {
  id: string;
  role: 'owner' | 'shift_lead' | 'tenant';
  email: string;
  displayName: string;
  tenant: { id: string; businessName: string; status: string; suspendedReason: string | null } | null;
}

export interface ApiErrorShape {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export class ApiFail {
  constructor(public status: number, public body: ApiErrorShape | null) {}
}

export interface ReqTag { sessionId: string }

export const state = {
  me: null as Me | null,
  sessionId: 'anon',
};

// Every request passes through one path that tags it with the sign-in it was
// sent under, so a late answer from an earlier sign-in is discarded by callers.
export async function api(
  method: string,
  path: string,
  opts: { body?: unknown; form?: FormData; idempotencyKey?: string; raw?: boolean } = {},
): Promise<{ ok: unknown; fail: ApiFail; status: number; headers: Headers } & Record<string, unknown>> {
  const headers: Record<string, string> = {};
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  let body: BodyInit | undefined;
  if (opts.form !== undefined) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    return { ok: null, fail: new ApiFail(0, null), status: 0, headers: new Headers() };
  }
  const sentUnder = state.sessionId;
  if (opts.raw) {
    return { ok: res, fail: null as unknown as ApiFail, status: res.status, headers: res.headers, sentUnder };
  }
  let data: unknown = null;
  let fail: ApiFail | null = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status >= 400) {
    fail = new ApiFail(res.status, data as ApiErrorShape | null);
    data = null;
  }
  return { ok: data, fail: fail as ApiFail, status: res.status, headers: res.headers, sentUnder };
}

// The browser's estimate of the server's clock, from response `now` fields.
class ServerClock {
  epoch = 0;
  at = 0;
  zone = 'UTC';

  update(isoNow: string, zone?: string): void {
    const t = Date.parse(isoNow);
    if (!Number.isNaN(t)) {
      this.epoch = t;
      this.at = performance.now();
    }
    if (zone) this.zone = zone;
  }

  now(): number {
    return this.epoch + (performance.now() - this.at);
  }
}

export const serverClock = new ServerClock();

export function hhmmKitchen(epoch: number, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(epoch));
}

export function longDateKitchen(epoch: number, zone: string): string {
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short' }).format(new Date(epoch));
  const rest = new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(epoch));
  return `${weekday} ${rest}`;
}

export function dateKeyKitchen(epoch: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(epoch));
  return parts.replace(/\//g, '-');
}

export function addDaysKey(key: string, zone: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const noon = Date.UTC(y, m - 1, d, 12) + days * 86_400_000;
  return dateKeyKitchen(noon, zone);
}

export function longDateFromKey(key: string, zone: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return longDateKitchen(Date.UTC(y, m - 1, d, 12), zone);
}

export function durationText(minutes: number): string {
  if (minutes <= 0) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

export function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function el(tag: string, attrs: Record<string, unknown> | null, ...children: Array<Node | string | null | undefined>): HTMLElement {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = String(v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v as EventListener);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

export function clear<T extends Element>(node: T): T {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function focusSafe(node: HTMLElement | null): void {
  if (node) {
    node.setAttribute('tabindex', '-1');
    node.focus();
  }
}
