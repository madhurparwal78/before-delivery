// Browser helpers: DOM, fetch, storage, and the small domain helpers the
// UI needs. The browser only renders what the server returns.

export interface SessionInfo {
  role: 'dreamer' | 'coach';
  name: string;
  id: string;
}

export interface NightInfo {
  night_key: string;
  night_number: number;
  first_night: string | null;
  capture_window: 'open' | 'closed';
  bedtime: string;
  wake_alarm: string;
  home_tz: string;
  technique_unlocked: boolean;
  cohort_phase: string;
}

export interface EntryInfo {
  id: string;
  night_key: string;
  night_number: number;
  title: string;
  text: string;
  dreams_recalled: number;
  lucid: boolean;
  wbtb: boolean;
  technique: 'none' | 'mild' | 'ssild';
  technique_minutes: number;
  late_recall: boolean;
  shared: boolean;
  created_at: string;
  memo: { content_type: string; size_bytes: number; duration_ms: number } | null;
  signs: { id: string; entry_id: string; start: number; end: number; phrase: string; category: string; night_key: string }[];
}

export interface CohortInfo {
  id: string;
  name: string;
  coach_name: string;
  starts_on: string;
  phase: 'draft' | 'enrolling' | 'baseline' | 'technique' | 'closed';
  week: number | null;
  price_cents: number;
  seats: number;
  seats_left: number;
}

export interface EnrolmentInfo {
  id: string;
  cohort_id: string;
  cohort_name: string;
  name: string;
  email: string;
  status: 'pending_payment' | 'active' | 'refunded';
  price_cents: number;
  home_tz: string;
  bedtime: string;
  wake_alarm: string;
  first_night: string | null;
  receipt_status: 'none' | 'pending' | 'sent';
}

export interface RosterRowInfo {
  enrollment_id: string;
  display_name: string;
  status: 'active' | 'refunded';
  night_number: number;
  nights_logged: number;
  recall_rate: number;
  technique_minutes: number;
  wbtb_nights: number;
  reality_checks: number;
  sign_tallies: { inner_awareness: number; action: number; form: number; context: number };
  shared_entries: { entry_id: string; night_key: string; title: string; text: string; has_memo: boolean }[];
}

export interface ConstellationInfo {
  category: 'inner_awareness' | 'action' | 'form' | 'context';
  stars: number;
  tagged_nights: number;
  halo_px: number;
}

export interface ApiErrorBody {
  error?: string;
  errors?: Record<string, string>;
  status?: string;
  [key: string]: unknown;
}

export async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T & ApiErrorBody }> {
  const headers = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body !== undefined && !(init.body instanceof Blob) && headers['Content-Type'] === undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, {
    method: init?.method,
    headers,
    body: init?.body,
    credentials: 'same-origin',
  });
  let body = {} as T & ApiErrorBody;
  try {
    body = (await response.json()) as T & ApiErrorBody;
  } catch {
    body = {} as T & ApiErrorBody;
  }
  return { ok: response.ok, status: response.status, body };
}

type AttrValue = string | boolean | ((event: Event) => void) | (() => void) | null | undefined;
type Attrs = Record<string, AttrValue>;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') node.setAttribute('class', String(v));
    else if (k === 'text') node.textContent = String(v);
    else if (k.startsWith('on')) {
      node.addEventListener(k.slice(2), v as EventListener);
    } else if (k === 'value') {
      (node as unknown as HTMLInputElement).value = String(v);
    } else if (k === 'checked') {
      (node as unknown as HTMLInputElement).checked = v === true || v === 'true';
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Node): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function formatMoney(cents: number): string {
  const dollars = cents / 100;
  const str = dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${str}`;
}

export function seatsCopy(left: number): string {
  if (left <= 0) return 'Full';
  if (left === 1) return '1 seat left';
  return `${left} seats left`;
}

export function phaseLabel(phase: string, week: number | null): string {
  if (phase === 'draft') return 'Draft';
  if (phase === 'enrolling') return 'Enrolling';
  if (phase === 'baseline') return `Baseline – week ${week} of 4`;
  if (phase === 'technique') return `Technique – week ${week} of 4`;
  return 'Closed';
}

export function rosterNight(n: number): string {
  if (n <= 0) return 'Not started';
  const capped = Math.min(n, 28);
  return `${capped} of 28`;
}

export function addDays(key: string, days: number): string {
  const dt = new Date(Date.parse(`${key}T00:00:00Z`));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function scrollYTo(element: HTMLElement): void {
  element.scrollIntoView({ block: 'nearest' });
}

export function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function focusFirst(container: HTMLElement): void {
  const focusables = container.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
  const first = focusables[0];
  if (first) first.focus();
}

export function trapFocus(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusables = Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((n) => n.offsetParent !== null || container.contains(n));
  if (focusables.length === 0) return;
  const first = focusables[0] as HTMLElement;
  const last = focusables[focusables.length - 1] as HTMLElement;
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey) {
    if (active === first || !container.contains(active)) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last || !container.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}
