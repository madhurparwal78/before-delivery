type Attributes = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (name === 'html') node.innerHTML = String(value);
    else if (name.startsWith('.')) (node as unknown as Record<string, unknown>)[name.slice(1)] = value;
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function num(value: string, extra = ''): HTMLElement {
  return el('span', { class: `num ${extra}`.trim(), text: value });
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogHandle {
  close: () => void;
  element: HTMLElement;
}

let openDialogs: DialogHandle[] = [];

/** Opens a modal dialog that keeps focus inside itself and returns focus to its opener. */
export function openDialog(options: {
  label: string;
  role?: 'dialog' | 'alertdialog';
  content: (close: () => void) => Node[];
  initialFocus?: string;
  opener?: HTMLElement | null;
  onClose?: () => void;
}): DialogHandle {
  const opener = options.opener ?? (document.activeElement as HTMLElement | null);
  const overlay = el('div', { class: 'overlay' });
  const panel = el('div', {
    class: 'dialog',
    role: options.role ?? 'dialog',
    'aria-modal': 'true',
    'aria-label': options.label,
  });
  const handle: DialogHandle = {
    element: panel,
    close: () => {
      if (!overlay.isConnected) return;
      overlay.remove();
      openDialogs = openDialogs.filter((candidate) => candidate !== handle);
      document.removeEventListener('keydown', onKeydown, true);
      options.onClose?.();
      if (opener && opener.isConnected) opener.focus();
    },
  };

  function onKeydown(event: KeyboardEvent): void {
    if (openDialogs[openDialogs.length - 1] !== handle) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      handle.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  panel.append(...options.content(handle.close));
  overlay.append(panel);
  document.body.append(overlay);
  openDialogs.push(handle);
  document.addEventListener('keydown', onKeydown, true);
  if (!prefersReducedMotion()) panel.classList.add('dialog-enter');
  const target =
    (options.initialFocus ? panel.querySelector<HTMLElement>(options.initialFocus) : null) ??
    panel.querySelector<HTMLElement>(FOCUSABLE);
  target?.focus();
  return handle;
}

export function table(
  label: string,
  headers: readonly string[],
  rows: readonly { cells: Child[]; className?: string }[],
): HTMLElement {
  return el('table', { class: 'grid-table', 'aria-label': label }, [
    el('thead', {}, [el('tr', {}, headers.map((header) => el('th', { scope: 'col', text: header })))]),
    el(
      'tbody',
      {},
      rows.map((row) =>
        el(
          'tr',
          { class: row.className ?? '' },
          row.cells.map((cell) => el('td', {}, [cell])),
        ),
      ),
    ),
  ]);
}

export function animateNumber(node: HTMLElement, from: bigint, to: bigint, durationMs: number, render: (value: bigint) => string): void {
  if (durationMs <= 0 || from === to) {
    node.textContent = render(to);
    return;
  }
  const start = performance.now();
  const span = Number(to - from);
  function frame(now: number): void {
    const progress = Math.min(1, (now - start) / durationMs);
    const value = from + BigInt(Math.round(span * progress));
    node.textContent = render(progress >= 1 ? to : value);
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
