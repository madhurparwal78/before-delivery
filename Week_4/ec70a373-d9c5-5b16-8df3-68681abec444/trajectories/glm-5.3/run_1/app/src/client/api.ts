import type { Balances, Booking, MeBody, VisitRecord } from '../shapes.js';
import type { Json } from '../types.js';
import { formatHoursTwo, formatMoney } from '../labels.js';

export interface ApiOutcome<T> {
  status: number;
  body: T | null;
  error: { code: string; message: string; fields?: Record<string, string> } | null;
  replay: boolean;
  dateHeader: string | null;
}

/** The server-now estimate: the browser clock plus the latest Date-header offset. */
let clockOffsetMs = 0;

export function serverNowMs(): number {
  return Date.now() + clockOffsetMs;
}

function noteClock(dateHeader: string | null): void {
  if (dateHeader === null) return;
  const server = Date.parse(dateHeader);
  if (Number.isNaN(server)) return;
  clockOffsetMs = server - Date.now();
}

export async function api<T = Json>(
  method: string,
  path: string,
  body?: Json | FormData,
  options?: { idempotencyKey?: string },
): Promise<ApiOutcome<T>> {
  const headers: Record<string, string> = {};
  const csrf = readCookie('pl_csrf');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && csrf) {
    headers['X-CSRF-Token'] = csrf;
  }
  if (options?.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  noteClock(response.headers.get('Date'));
  const replay = response.headers.get('Idempotent-Replay') === 'true';
  const text = await response.text();
  let parsed: Json | null = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text) as Json;
    } catch {
      parsed = null;
    }
  }
  if (response.ok) {
    return { status: response.status, body: parsed as T, error: null, replay, dateHeader: response.headers.get('Date') };
  }
  const errorBody = parsed as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null;
  return {
    status: response.status,
    body: null,
    error: {
      code: String(errorBody?.error?.code ?? 'unknown'),
      message: String(errorBody?.error?.message ?? ''),
      fields: errorBody?.error?.fields,
    },
    replay,
    dateHeader: response.headers.get('Date'),
  };
}

export function readCookie(name: string): string | null {
  const header = document.cookie;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(name + '=')) return decodeURIComponent(trimmed.slice(name.length + 1));
  }
  return null;
}

export interface AppSession {
  me: MeBody;
}

let session: AppSession | null = null;

export function currentSession(): AppSession | null {
  return session;
}

export async function loadSession(): Promise<AppSession | null> {
  const outcome = await api<MeBody>('GET', '/api/me');
  if (outcome.status !== 200 || outcome.body === null) {
    session = null;
    return null;
  }
  session = { me: outcome.body };
  return session;
}

export function clearSession(): void {
  session = null;
}

export function roleHome(role: string): string {
  if (role === 'kitchen_manager') return '/site';
  if (role === 'finance_lead') return '/rates';
  return '/book';
}

export function isRoleHome(path: string, role: string): boolean {
  const homes: Record<string, string[]> = {
    member: ['/book', '/packs', '/documents', '/truck'],
    kitchen_manager: ['/site', '/compliance', '/trucks'],
    finance_lead: ['/rates', '/reports'],
  };
  return (homes[role] ?? []).includes(path);
}

export function formatHours(qh: number | null | undefined): string {
  return formatHoursTwo(qh ?? 0);
}

export function formatCents(cents: number): string {
  return formatMoney(cents);
}

export function ticketStatusWord(booking: Booking): string {
  switch (booking.status) {
    case 'held': return 'Held';
    case 'confirmed': return 'Confirmed';
    case 'checked_in': return 'Checked in';
    case 'checked_out': return 'Checked out';
    case 'no_show': return 'No-show';
    case 'cancelled': return 'Cancelled';
    case 'expired': return 'Expired';
  }
}

export function gapCellText(visit: VisitRecord): string {
  if (visit.gap_hours === null) return '—';
  if (visit.gap_flagged) return `Gap ${formatHoursTwo(visit.gap_hours)} h — over 24 hours`;
  return `${formatHoursTwo(visit.gap_hours)} h`;
}
