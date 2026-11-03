// Shared rendering helpers: h() builds elements, live regions announce.
export type Child = Node | string | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') el.className = String(value);
    else if (name === 'dataset') Object.assign(el.dataset, value as Record<string, string>);
    else if (name.startsWith('on') && typeof value === 'function') {
      el.addEventListener(name.slice(2), value as EventListener);
    } else if (value === true) el.setAttribute(name, '');
    else el.setAttribute(name, String(value));
  }
  append(el, children);
  return el;
}

export function append(parent: HTMLElement, children: Child): void {
  for (const child of [children].flat(4) as Child[]) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === 'string') parent.appendChild(document.createTextNode(child));
    else parent.appendChild(child as Node);
  }
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// A status live region: visible copy that is also announced.
export function statusRegion(label: string, extraClass?: string): { el: HTMLElement; set: (text: string, kind?: 'pending' | 'success' | 'error') => void } {
  const el = h('p', { class: `status-region ${extraClass ?? ''}`.trim(), role: 'status', 'aria-label': label });
  let last = '';
  return {
    el,
    set(text: string, kind?: 'pending' | 'success' | 'error') {
      // Only announce when the text changes, so repeated updates stay quiet.
      if (text === last && kind === 'pending') return;
      last = text;
      el.className = `status-region ${kind === 'error' ? 'error' : kind === 'pending' ? 'pending' : ''} ${extraClass ?? ''}`.trim();
      clear(el);
      el.appendChild(document.createTextNode(text));
    },
  };
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function fileKb(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export interface DialogHandle {
  close: () => void;
}

export function openDialog(opts: {
  label: string;
  build: (root: HTMLElement, close: () => void) => void;
  onClose?: () => void;
}): DialogHandle {
  const backdrop = h('div', { class: 'dialog-backdrop fade-in' });
  const dialog = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label, class: 'dialog' });
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  const opener = document.activeElement as HTMLElement | null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    document.body.removeChild(backdrop);
    if (opener && document.body.contains(opener)) opener.focus();
    opts.onClose?.();
  };

  opts.build(dialog, close);

  const focusables = dialog.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
  );
  (focusables[0] ?? dialog).focus();

  const keydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      document.removeEventListener('keydown', keydown, true);
      return;
    }
    if (e.key === 'Tab') {
      const list = [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled'));
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', keydown, true);
  return { close };
}
