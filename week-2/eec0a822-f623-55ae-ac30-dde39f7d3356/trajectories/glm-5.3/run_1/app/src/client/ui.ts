export function qs<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  return root.querySelector(sel) as T;
}

export function qsa<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll(sel)] as T[];
}

/** Build an element with attributes and children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, unknown>, ...children: unknown[]): HTMLElementTagNameMap[K];
export function h(tag: string, attrs?: Record<string, unknown>, ...children: unknown[]): HTMLElement;
export function h(tag: string, attrs: Record<string, unknown> = {}, ...children: unknown[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export interface DialogOptions {
  label: string;
  /** First focusable control, or a selector for it. */
  sheet?: boolean;
  onClose?: () => void;
}

export interface DialogController {
  el: HTMLElement;
  close(): void;
  addEventListener(type: string, fn: EventListener): void;
  opener: HTMLElement | null;
}

let openDialogs: DialogController[] = [];

/**
 * Open a dialog or sheet with the published behaviour: hidden and inert when
 * closed, focus moved to its first control, Tab wrapped inside, Escape
 * returns focus to the opener, and reopening during its exit keeps it open.
 */
export function openDialog(label: string, build: (panel: HTMLElement, controller: DialogController) => void, opts: { sheet?: boolean } = {}): DialogController {
  const backdrop = h('div', { class: 'backdrop' });
  const panel = h('div', { class: 'panel', role: 'document' });
  const el = h('div', { class: opts.sheet ? 'sheet' : 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, backdrop, panel);
  el.setAttribute('open', '');
  document.body.append(el);
  // Body scroll lock while open.
  const priorOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let closing = false;
  let closed = false;
  let closeTimer: number | null = null;
  const controller: DialogController = {
    el,
    opener,
    close,
    addEventListener: () => undefined,
  };
  function close() {
    if (closed || closing) return;
    closing = true;
    el.setAttribute('data-closing', '');
    closeTimer = window.setTimeout(() => {
      el.remove();
      document.body.style.overflow = priorOverflow;
      openDialogs = openDialogs.filter((d) => d !== controller);
      closed = true;
      if (opener && document.contains(opener)) opener.focus();
    }, 360);
  }
  controller.close = close;
  el.addEventListener('cancelReopen', () => {
    // Reopened during its exit: keep it open.
    if (closing && !closed) {
      closing = false;
      if (closeTimer !== null) window.clearTimeout(closeTimer);
      el.removeAttribute('data-closing');
      document.body.style.overflow = 'hidden';
    }
  });
  // An existing dialog being reopened keeps its place; the caller passes the
  // same label and the controller list finds it.
  const existing = openDialogs.find((d) => (d.el as HTMLElement & { dataset: Record<string, string> }).dataset?.label === label);
  if (existing) {
    existing.el.dispatchEvent(new CustomEvent('cancelReopen'));
  }
  openDialogs.push(controller);
  (el as HTMLElement & { dataset: Record<string, string> }).dataset.label = label;
  build(panel, controller);
  // Focus trap.
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = focusableIn(el);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  backdrop.addEventListener('click', () => close());
  // Move focus to the first control.
  window.setTimeout(() => {
    const focusables = focusableIn(el);
    (focusables[0] ?? panel).focus();
  }, 0);
  return controller;
}

export function focusableIn(root: HTMLElement): HTMLElement[] {
  const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll<HTMLElement>(sel)].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null || el === document.activeElement);
}

/** Announce a message in the shared live region. */
export function announce(message: string): void {
  const region = qs<HTMLElement>('[data-announcements]');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = message;
  }, 10);
}

export function passageAnnounce(message: string): void {
  const region = qs<HTMLElement>('[data-passage-updates]');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = message;
  }, 10);
}

/** Show a message next to an action; returns a function to clear it later. */
export function message(kind: 'ok' | 'err', text: string, container: HTMLElement | null): void {
  if (!container) return;
  container.textContent = '';
  container.append(h('p', { class: `msg ${kind}`, role: 'status' }, text));
}

export function clearMessage(container: HTMLElement | null): void {
  if (container) container.textContent = '';
}
