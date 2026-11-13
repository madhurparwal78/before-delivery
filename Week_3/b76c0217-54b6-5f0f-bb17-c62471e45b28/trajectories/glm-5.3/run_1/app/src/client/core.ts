export const TIMERS = {
  autosavePause: 800,
  searchDebounce: 150,
  searchRecordPause: 1000,
  drawer: 200,
  accordion: 150,
  theme: 200,
  spliceStrike: 240,
  spliceSet: 420,
  spliceStagger: 18,
  spliceFile: 320,
  spliceCount: 600,
  noticeFade: 4000,
} as const;

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export type Timer = { cancel(): void };

export function delay(ms: number): { promise: Promise<void>; cancel(): void } {
  let handle: number | undefined;
  let resolveFn: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
    handle = window.setTimeout(() => resolve(), ms);
  });
  return {
    promise,
    cancel() {
      if (handle !== undefined) window.clearTimeout(handle);
      resolveFn?.();
    },
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export async function api<T>(method: string, url: string, body?: unknown, opts: { raw?: boolean; headers?: Record<string, string> } = {}): Promise<{ status: number; data: T | null; error: { code: string; message: string; fields?: Record<string, string> } | null }> {
  const init: RequestInit = {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers ?? {}) },
    credentials: 'same-origin',
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  let data: T | null = null;
  let error: { code: string; message: string; fields?: Record<string, string> } | null = null;
  try {
    if (text) {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        error = (parsed as { error: { code: string; message: string; fields?: Record<string, string> } }).error;
      } else {
        data = parsed as T;
      }
    }
  } catch {
    data = null;
  }
  return { status: res.status, data, error };
}

export function announce(message: string): void {
  const region = document.getElementById('announcer');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => { region.textContent = message; }, 10);
}

export function qs<E extends Element = HTMLElement>(sel: string): E | null {
  return document.querySelector(sel) as E | null;
}

export function qsa<E extends Element = HTMLElement>(sel: string): E[] {
  return Array.from(document.querySelectorAll(sel)) as E[];
}

export function focusable(el: HTMLElement | ParentNode): HTMLElement[] {
  const list = (el instanceof HTMLElement ? el : el).querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  return Array.from(list).filter((n) => n.offsetParent !== null || n.closest('[hidden]') === null);
}

export function trapFocus(container: HTMLElement): void {
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = focusable(container);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

export type ModalHandle = {
  close(): void;
  element: HTMLElement;
};

export function openModal(el: HTMLElement, opener: HTMLElement | null): ModalHandle {
  el.setAttribute('aria-modal', 'true');
  el.hidden = false;
  el.classList.add('open');
  const openerWas = opener ?? document.activeElement instanceof HTMLElement ? document.activeElement as HTMLElement : null;
  trapFocus(el);
  const first = focusable(el)[0] ?? el;
  window.setTimeout(() => first.focus(), 0);
  return {
    close() {
      el.hidden = true;
      el.classList.remove('open');
      el.removeAttribute('aria-modal');
      openerWas?.focus();
    },
    element: el,
  };
}
