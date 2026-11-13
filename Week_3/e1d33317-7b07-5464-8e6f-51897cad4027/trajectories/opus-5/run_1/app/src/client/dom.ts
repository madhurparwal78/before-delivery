type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

export function button(
  label: string,
  attributes: Attributes = {},
  onClick?: () => void,
): HTMLButtonElement {
  const node = el('button', { type: 'button', ...attributes }, [label]);
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

/** Shows "…" on the control that started a request and puts it back afterwards. */
export async function whilePending<T>(
  control: HTMLButtonElement,
  work: () => Promise<T>,
): Promise<T> {
  const label = control.textContent ?? '';
  control.disabled = true;
  control.textContent = `${label.replace(/…$/, '')}…`;
  try {
    return await work();
  } finally {
    control.disabled = false;
    control.textContent = label;
  }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogHandle {
  root: HTMLElement;
  close: () => void;
}

/** Dialogs and sheets: focus moves in, Tab wraps, Escape closes, focus returns. */
export function openDialog(
  title: string,
  build: (close: () => void) => HTMLElement[],
  role: 'dialog' | 'alertdialog' = 'dialog',
): DialogHandle {
  const opener = document.activeElement as HTMLElement | null;
  const scrim = el('div', { class: 'scrim' });
  const heading = el('h2', { id: `dialog-title-${Math.random().toString(36).slice(2)}` }, [title]);
  const dialog = el('div', {
    class: 'dialog',
    role,
    'aria-modal': 'true',
    'aria-labelledby': heading.id,
  });
  const close = (): void => {
    scrim.remove();
    opener?.focus();
  };
  dialog.append(heading, ...build(close));
  scrim.append(dialog);
  document.body.append(scrim);

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );
    if (stops.length === 0) return;
    const first = stops[0]!;
    const last = stops[stops.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  const firstField = dialog.querySelector<HTMLElement>(FOCUSABLE);
  firstField?.focus();
  return { root: dialog, close };
}

export interface FieldErrorView {
  summary: HTMLElement;
  show: (errors: Record<string, string>) => void;
}

/** The dialog error summary: a heading and one link per field error. */
export function errorSummary(dialog: HTMLElement): FieldErrorView {
  const list = el('ul');
  const summary = el('div', { class: 'error-summary', role: 'alert', hidden: true }, [
    el('strong', {}, ['There is a problem']),
    list,
  ]);
  return {
    summary,
    show: (errors) => {
      clear(list);
      for (const node of dialog.querySelectorAll('.field-error')) node.remove();
      const keys = Object.keys(errors);
      summary.hidden = keys.length === 0;
      for (const key of keys) {
        const message = errors[key]!;
        const field = dialog.querySelector<HTMLElement>(`[data-field="${key}"]`);
        const link = el('a', { href: '#' }, [message]);
        link.addEventListener('click', (event) => {
          event.preventDefault();
          field?.focus();
        });
        list.append(el('li', {}, [link]));
        field?.parentElement?.append(el('p', { class: 'field-error' }, [message]));
      }
      if (keys.length > 0) summary.focus();
    },
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isPhone(): boolean {
  return window.innerWidth < 768;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => [...part][0]!.toUpperCase())
    .join('');
}
