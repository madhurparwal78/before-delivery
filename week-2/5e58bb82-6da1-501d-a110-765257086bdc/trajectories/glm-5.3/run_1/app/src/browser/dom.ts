/* DOM helpers: element builder, live regions, modal dialogs with focus trap. */

export type Child = Node | string | null | undefined | false;

export function h(tag: string, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2), v as EventListener);
    } else if (k === 'dataset') {
      for (const [dk, dv] of Object.entries(v as Record<string, string>)) el.dataset[dk] = dv;
    } else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

// ---------- announcements and statuses ----------

export interface LiveRegions {
  fleetAnnouncements: HTMLElement;
  serviceStatus: HTMLElement;
  sessionStatus: HTMLElement;
}

export function setStatusText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

// ---------- dialogs ----------

export interface DialogHandle {
  close(): void;
  root: HTMLDivElement;
}

export interface DialogOpts {
  label: string;
  onEscape?: () => boolean | void; // return true to consume Escape
  noTrap?: boolean;
  onClose?: () => void;
}

const openDialogs: DialogHandle[] = [];

export function openModal(opts: DialogOpts, build: (root: HTMLDivElement, close: () => void) => void): DialogHandle {
  const opener = document.activeElement as HTMLElement | null;
  const backdrop = h('div', { class: 'dialog-backdrop' }) as HTMLDivElement;
  const root = h('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': opts.label,
    class: 'dialog',
  }) as HTMLDivElement;
  backdrop.append(root);
  let closed = false;
  const handle: DialogHandle = {
    root,
    close(): void {
      if (closed) return;
      closed = true;
      const idx = openDialogs.indexOf(handle);
      if (idx >= 0) openDialogs.splice(idx, 1);
      document.body.removeChild(backdrop);
      document.removeEventListener('keydown', trapKeys, true);
      opts.onClose?.();
      const target = opener && document.body.contains(opener) ? opener : null;
      if (target) target.focus();
    },
  };
  function focusables(): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(e => e.offsetParent !== null || e === document.activeElement);
  }
  function trapKeys(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (opts.onEscape && opts.onEscape() === true) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      handle.close();
      return;
    }
    if (e.key === 'Tab') {
      const f = focusables();
      if (f.length === 0) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (!root.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  document.addEventListener('keydown', trapKeys, true);
  build(root, handle.close);
  document.body.append(backdrop);
  openDialogs.push(handle);
  return handle;
}

export function anyDialogOpen(): boolean { return openDialogs.length > 0; }

// ---------- misc ----------

export function focusSafe(el: HTMLElement | null): void {
  if (el) {
    try { el.focus(); } catch { /* detached */ }
  }
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
