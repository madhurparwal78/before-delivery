import { Announcer } from './live.js';

export function el(tag: string, attrs: Record<string, any> = {}, ...children: (Node | string | null | undefined)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function textNode(s: string): Text {
  return document.createTextNode(s);
}

// Focus trap for dialogs and drawers: Tab never reaches the page behind.
export function trapFocus(container: HTMLElement, onEscape: () => void): (e: KeyboardEvent) => void {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((n) => n.offsetParent !== null || n.closest('dialog[open]'));
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
  };
  container.addEventListener('keydown', handler);
  return handler;
}

export function openDialog(
  build: () => HTMLElement,
  opts: { labelledBy: string; onClose: () => void; onOpen?: (dlg: HTMLDialogElement) => void }
): HTMLDialogElement {
  const dlg = document.createElement('dialog');
  dlg.className = 'rb-dialog';
  dlg.setAttribute('aria-labelledby', opts.labelledBy);
  const body = build();
  dlg.append(body);
  document.body.append(dlg);
  // every "close this dialog" control inside the body works on this instance
  for (const closer of Array.from(body.querySelectorAll<HTMLElement>('[data-close]'))) {
    closer.addEventListener('click', () => dlg.close());
  }
  dlg.addEventListener('close', () => {
    opts.onClose();
    dlg.remove();
  });
  dlg.showModal();
  const firstField = dlg.querySelector<HTMLElement>('input, select, textarea, button, a');
  if (firstField) firstField.focus();
  trapFocus(dlg, () => {
    dlg.close();
  });
  opts.onOpen?.(dlg);
  (dlg as any)._closers = Array.from(body.querySelectorAll<HTMLElement>('[data-close]'));
  return dlg;
}

export function errorSummary(items: { message: string; focus: () => void }[]): HTMLElement {
  const list = el('ul');
  const focusables: (() => void)[] = [];
  for (const item of items) {
    focusables.push(item.focus);
    const link = el('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); item.focus(); } }, item.message);
    const li = el('li', {}, link);
    list.append(li);
  }
  const box = el('div', { role: 'alert', class: 'alert-banner', 'data-testid': 'error-summary' }, el('h3', { text: 'Please fix the following:' }), list);
  (box as any)._focusOrder = focusables;
  return box;
}

export function pill(label: string, onClick: () => void, variant = 'primary', extra: Record<string, any> = {}): HTMLButtonElement {
  const btn = el('button', { class: `pill pill-${variant}`, onclick: onClick, ...extra }, label) as HTMLButtonElement;
  return btn;
}

export function bannerAlert(message: string): HTMLElement {
  return el('div', { role: 'alert', class: 'alert-banner' }, message);
}

export function inlineError(message: string): HTMLElement {
  return el('p', { role: 'alert', class: 'alert-inline' }, message);
}
