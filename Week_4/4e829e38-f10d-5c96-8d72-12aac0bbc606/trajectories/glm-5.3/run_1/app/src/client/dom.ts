import { clock } from './clock';
import { config } from './motion';

export interface ApiError { error?: string; errors?: Record<string, string>; latest?: number; holder?: string; }

export async function api<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T & ApiError }> {
  const r = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data: unknown = null;
  const text = await r.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  return { ok: r.ok, status: r.status, data: (data ?? {}) as T & ApiError };
}

/* ---------- DOM helpers ---------- */

export function h(tag: string, attrs?: Record<string, string | number | boolean | ((e: never) => void)> | null, ...children: (Node | string | null | undefined | false)[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v as EventListener);
      } else if (k === 'text') {
        el.textContent = String(v);
      } else if (typeof v === 'boolean') {
        if (v) el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function statusRegion(id: string, ariaLive: 'polite' | 'assertive' = 'polite'): HTMLElement {
  let el = document.getElementById(id);
  if (!el) {
    el = h('div', { id, role: 'status', 'aria-live': ariaLive, class: 'visually-hidden' });
    document.body.append(el);
  }
  return el;
}

export function announce(id: string, text: string, ariaLive: 'polite' | 'assertive' = 'polite'): void {
  const el = statusRegion(id, ariaLive);
  el.textContent = '';
  el.textContent = text;
}

export interface ToastHost { show: (text: string) => void; host: HTMLElement; }

export function toastHost(): ToastHost {
  let host = document.querySelector<HTMLElement>('.toasts');
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const show = (text: string): void => {
    const t = h('div', { class: 'toast', text }, text);
    host!.append(t);
    const life = config().toastMs;
    const start = clock.now();
    const step = (now: number): void => {
      const x = (now - start) / life;
      if (x < 0.9) { clock.onFrame(step); return; }
      t.style.opacity = String(Math.max(0, 1 - (x - 0.9) / 0.1));
      if (x < 1) clock.onFrame(step);
      else t.remove();
    };
    clock.onFrame(step);
  };
  return { show, host };
}

/* ---------- focus helpers ---------- */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusable(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(x => x.offsetParent !== null || x === document.activeElement);
}

/** Keeps Tab inside a dialog, sheet or popover. */
export function trapFocus(container: HTMLElement, onEscape?: () => void): (e: KeyboardEvent) => void {
  const handler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEscape?.();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusable(container);
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  container.addEventListener('keydown', handler);
  return handler;
}

export function untrapFocus(container: HTMLElement, handler: (e: KeyboardEvent) => void): void {
  container.removeEventListener('keydown', handler);
}

/** Opens a dialog and returns a closer that restores focus to the opener. */
export interface DialogHandle {
  close: () => void;
  container: HTMLElement;
}

export function openDialog(builder: (container: HTMLElement, close: () => void) => void, opener?: HTMLElement | null): DialogHandle {
  const overlay = h('div', { class: 'overlay' });
  const container = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' });
  overlay.append(container);
  document.body.append(overlay);
  const close = (): void => {
    untrapFocus(container, trap);
    overlay.remove();
    if (opener && document.contains(opener)) opener.focus();
    else {
      const fallback = document.querySelector<HTMLElement>('#app');
      fallback?.setAttribute('tabindex', '-1');
      fallback?.focus();
    }
  };
  builder(container, close);
  const trap = trapFocus(container, close);
  const first = focusable(container)[0];
  if (first) first.focus();
  return { close, container };
}

/** Puts focus at least 72px below the sticky bar. */
export function focusBelowBar(el: HTMLElement): void {
  el.scrollIntoView({ block: 'center' });
  el.focus();
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function fmtNum(n: number): string {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 10 }).format(n);
}
