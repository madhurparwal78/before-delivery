import { el, focusableWithin, prefersReducedMotion } from './dom';

export interface DialogHandle {
  readonly name: string;
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  close(): void;
  rebuild(children: Node[]): void;
}

interface DialogOptions {
  name: string;
  role?: 'dialog' | 'alertdialog';
  opener: HTMLElement | null;
  className?: string;
  build: (handle: DialogHandle) => Node[];
  onClose?: () => void;
  /** Used when a repaint has replaced the opener, so focus still comes back to its place. */
  restoreFocus?: () => void;
}

const stack: DialogHandle[] = [];

/** Panels still playing their closing motion, so reopening one cancels the hide. */
const leaving = new Map<string, { node: HTMLElement; timer: number }>();

function dropLeaving(name: string): void {
  const pending = leaving.get(name);
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pending.node.remove();
  leaving.delete(name);
}

function host(): HTMLElement {
  let node = document.getElementById('dialog-host');
  if (!node) {
    node = el('div', { id: 'dialog-host' });
    document.body.append(node);
  }
  return node;
}

export function openDialogFor(options: DialogOptions): DialogHandle {
  const body = el('div', { class: 'dialog-body' });
  const root = el(
    'div',
    {
      role: options.role ?? 'dialog',
      'aria-modal': 'true',
      'aria-label': options.name,
      class: `dialog ${options.className ?? ''}`.trim(),
    },
    [body],
  );
  let closed = false;
  const handle: DialogHandle = {
    name: options.name,
    root,
    body,
    close() {
      if (closed) return;
      closed = true;
      const index = stack.indexOf(handle);
      if (index >= 0) stack.splice(index, 1);
      const opener = options.opener;
      if (prefersReducedMotion()) {
        root.remove();
      } else {
        root.classList.add('leaving');
        leaving.set(options.name, {
          node: root,
          timer: window.setTimeout(() => dropLeaving(options.name), 250),
        });
      }
      if (options.onClose) options.onClose();
      if (opener && document.contains(opener)) opener.focus();
      else if (options.restoreFocus) options.restoreFocus();
    },
    rebuild(children: Node[]) {
      while (body.firstChild) body.removeChild(body.firstChild);
      body.append(...children);
    },
  };
  dropLeaving(options.name);
  body.append(...options.build(handle));
  host().append(root);
  stack.push(handle);
  if (!prefersReducedMotion()) {
    root.classList.add('entering');
    window.setTimeout(() => root.classList.remove('entering'), 250);
  }
  const first = focusableWithin(root)[0];
  if (first) first.focus();
  return handle;
}

function topDialog(): DialogHandle | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

export function closeAllDialogs(): void {
  while (stack.length > 0) stack[stack.length - 1].close();
}

function trapTab(event: KeyboardEvent): void {
  const top = topDialog();
  if (!top) return;
  const focusables = focusableWithin(top.root);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey) {
    if (active === first || !top.root.contains(active)) {
      event.preventDefault();
      last.focus();
    }
    return;
  }
  if (active === last || !top.root.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

document.addEventListener('keydown', (event) => {
  if (stack.length === 0) return;
  if (event.key === 'Tab') {
    trapTab(event);
    return;
  }
  if (event.key === 'Escape') {
    event.stopPropagation();
    const top = topDialog();
    if (top) top.close();
  }
});
