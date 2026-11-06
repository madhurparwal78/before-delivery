// Session state and shared UI patterns: live regions, dialogs, focus rules.

export interface Account { id: string; name: string; email: string; phone: string }

let account: Account | null = null;
let accountKnown = false;

export async function loadAccount(): Promise<Account | null> {
  if (accountKnown) return account;
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    if (r.ok) {
      account = await r.json();
    } else {
      account = null;
    }
  } catch {
    account = null;
  }
  accountKnown = true;
  return account;
}

export function currentAccount(): Account | null { return account; }
export function setAccount(a: Account | null): void {
  account = a;
  accountKnown = true;
}

/** A polite status region that holds one message at a time. */
export function statusRegion(name: string, text: string): HTMLElement {
  let el = document.querySelector<HTMLElement>(`[data-status="${name}"]`);
  if (!el) {
    el = document.createElement('div');
    el.setAttribute('data-status', name);
    el.className = 'status-line';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', name);
  }
  el.textContent = text;
  return el;
}

export function setStatus(name: string, text: string): void {
  const el = statusRegion(name, text);
  if (!el.isConnected) document.getElementById('live-regions')?.appendChild(el);
}

export function alertRegion(name: string, html: string): HTMLElement {
  let el = document.querySelector<HTMLElement>(`[data-alert="${name}"]`);
  if (!el) {
    el = document.createElement('div');
    el.setAttribute('data-alert', name);
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-label', name);
  }
  el.innerHTML = html;
  return el;
}

export function setAlert(name: string, html: string, focusIt = false): HTMLElement {
  const el = alertRegion(name, html);
  if (!el.isConnected) document.getElementById('live-regions')?.appendChild(el);
  if (focusIt) el.focus();
  return el;
}

export function clearAlert(name: string): void {
  document.querySelector(`[data-alert="${name}"]`)?.remove();
}

// ---------- dialogs ----------

export interface DialogHandle {
  el: HTMLDialogElement;
  close(): void;
}

/** Open a dialog with a focus trap: Tab wraps, Escape closes, focus returns to the opener. */
export function openDialog(build: (el: HTMLDialogElement) => void, opener: HTMLElement | null, initialFocus?: string): DialogHandle {
  const el = document.createElement('dialog');
  el.className = 'sheet';
  build(el);
  document.body.appendChild(el);
  let revert = () => {
    el.close();
    el.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      revert();
      opener?.focus();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = Array.from(el.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((x) => x.offsetParent !== null || x === el);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!el.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('close', () => {
    document.removeEventListener('keydown', onKey, true);
    el.remove();
  });
  el.showModal();
  const target = initialFocus ? el.querySelector<HTMLElement>(initialFocus) : null;
  (target ?? el.querySelector<HTMLElement>('button, input, select, a[href]'))?.focus();
  const originalRevert = revert;
  revert = () => {
    setInertBehind(el, false);
    originalRevert();
  };
  setInertBehind(el, true);
  return {
    el,
    close: revert,
  };
}

/** Hide everything behind an open dialog: inert and hidden from assistive technology. */
export function setInertBehind(el: HTMLDialogElement, inert: boolean): void {
  for (const child of Array.from(document.body.children)) {
    if (child === el) continue;
    if (inert) {
      (child as HTMLElement).inert = true;
      (child as HTMLElement).setAttribute('aria-hidden', 'true');
    } else {
      (child as HTMLElement).inert = false;
      (child as HTMLElement).removeAttribute('aria-hidden');
    }
  }
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

/** An id for form label wiring that is stable within a render. */
let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
