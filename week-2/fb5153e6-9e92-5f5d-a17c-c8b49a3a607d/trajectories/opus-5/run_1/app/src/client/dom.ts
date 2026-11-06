export function one<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function all<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

export function readState<T>(id: string): T | null {
  const node = document.getElementById(id);
  if (node === null || node.textContent === null) return null;
  return JSON.parse(node.textContent) as T;
}

export function setText(node: Element | null, text: string): void {
  if (node !== null) node.textContent = text;
}

/** Announcements re-fire even when the copy is unchanged. */
export function announce(node: Element | null, text: string): void {
  if (node === null) return;
  node.textContent = '';
  window.setTimeout(() => {
    node.textContent = text;
  }, 10);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function currentLang(): string | null {
  return new URL(window.location.href).searchParams.get('lang');
}

export function withLang(path: string): string {
  const lang = currentLang();
  if (lang === null) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set('lang', lang);
  return `${url.pathname}${url.search}`;
}

/** Keeps focus inside a dialog, wrapping at both ends. */
export function trapFocus(dialog: HTMLElement): () => void {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const handler = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const focusable = all<HTMLElement>(selector, dialog).filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener('keydown', handler);
  return () => dialog.removeEventListener('keydown', handler);
}

export interface DialogHandle {
  open(): void;
  close(): void;
}

export function manageDialog(
  dialog: HTMLDialogElement,
  opener: () => HTMLElement | null,
): DialogHandle {
  let release: (() => void) | null = null;
  const close = (): void => {
    if (!dialog.open) return;
    dialog.close();
    release?.();
    release = null;
    opener()?.focus();
  };
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  return {
    open(): void {
      dialog.showModal();
      release = trapFocus(dialog);
      const first = all<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]',
        dialog,
      )[0];
      first?.focus();
    },
    close,
  };
}
