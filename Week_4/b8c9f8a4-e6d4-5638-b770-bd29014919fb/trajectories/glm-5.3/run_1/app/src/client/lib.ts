/** Shared client-side helpers: formatting, units, API access, live regions, dialogs. */

export type UnitsMode = 'microns' | 'mils';

export const UNITS_STORAGE_KEY = 'ob-units';

export function readUnits(): UnitsMode {
  try {
    const v = localStorage.getItem(UNITS_STORAGE_KEY);
    if (v === 'mils' || v === 'microns') return v;
  } catch { /* storage unavailable */ }
  return 'microns';
}

export function writeUnits(mode: UnitsMode): void {
  try { localStorage.setItem(UNITS_STORAGE_KEY, mode); } catch { /* storage unavailable */ }
}

export function milsString(microns: number): string {
  const tenths = Math.floor(microns / 25.4 * 10 + 0.5);
  return (tenths / 10).toFixed(1);
}

export function gaugeFigure(microns: number, units: UnitsMode): string {
  return units === 'mils' ? `${milsString(microns)} mils` : `${microns} microns`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `14 Nov 2026, 10:30` in London, from a UTC instant. */
export function londonStamp(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  const london = new Date(date.getTime() + londonOffset(date) * 60_000);
  return `${london.getUTCDate()} ${MONTHS[london.getUTCMonth()]} ${london.getUTCFullYear()}, ${pad(london.getUTCHours())}:${pad(london.getUTCMinutes())}`;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

function londonOffset(date: Date): number {
  const y = date.getUTCFullYear();
  const lastSunday = (month: number, lastDay: number) => {
    const d = new Date(Date.UTC(y, month, lastDay));
    return d.getUTCDate() - d.getUTCDay();
  };
  const start = Date.UTC(y, 2, lastSunday(2, 31), 1);
  const end = Date.UTC(y, 9, lastSunday(9, 31), 1);
  return date.getTime() >= start && date.getTime() < end ? 60 : 0;
}

/** `<hours>h <minutes>m <seconds>s left` from the server's seconds. */
export function timeLeft(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${pad(m)}m ${pad(sec)}s left`;
}

export function pounds(amount: number): string {
  return '£' + amount.toLocaleString('en-GB');
}

export interface ApiError { error: string; message: string; errors?: Record<string, string>; [k: string]: unknown; }

export async function api<T = unknown>(path: string, init?: RequestInit & { idempotencyKey?: string }): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  if (init?.body && typeof init.body === 'string') headers['Content-Type'] = 'application/json';
  const reply = await fetch(path, { ...init, headers });
  if (reply.status === 204) return undefined as T;
  const text = await reply.text();
  let body: unknown = undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
  if (!reply.ok) {
    throw Object.assign(new Error((body as ApiError)?.message ?? 'That could not be sent'), {
      status: reply.status,
      body: body as ApiError,
      lostReply: reply.status >= 500 || reply.status === 0,
    });
  }
  return body as T;
}

/** A fetch that reports network failure as a lost reply. */
export class ApiCallError extends Error {
  status: number;
  body?: ApiError;
  lostReply: boolean;
  constructor(message: string, status: number, body: ApiError | undefined, lostReply: boolean) {
    super(message);
    this.status = status;
    this.body = body;
    this.lostReply = lostReply;
  }
}

export function isLostReply(err: unknown): boolean {
  return err instanceof ApiCallError ? err.lostReply : (err as { lostReply?: boolean })?.lostReply === true;
}

export function announce(statusEl: HTMLElement | null, message: string): void {
  if (!statusEl) return;
  // A repeated message is written again as a fresh update, so it is announced again.
  const fresh = statusEl.ownerDocument.createElement('div');
  fresh.textContent = message;
  statusEl.replaceChildren(fresh);
}

export function focusFirst(container: HTMLElement): void {
  const target = container.querySelector<HTMLElement>('input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])');
  (target ?? container).focus();
}

/** Focus trap and Escape handling for a dialog that is a real <dialog>. */
export function dialogFocusTrap(dialog: HTMLDialogElement, onEscape: () => void): (e: KeyboardEvent) => void {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onEscape(); return; }
    if (e.key !== 'Tab') return;
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true');
    if (focusables.length === 0) { e.preventDefault(); return; }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  dialog.addEventListener('keydown', handler);
  return handler;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function viewportWidth(): number {
  return document.documentElement.clientWidth;
}

export function isPhoneWidth(): boolean {
  return viewportWidth() <= 767;
}

export function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function clampUnit(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
