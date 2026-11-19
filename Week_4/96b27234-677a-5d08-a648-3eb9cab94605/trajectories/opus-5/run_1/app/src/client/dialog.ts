import { el, focusableIn, trapTab } from './dom.js';

export interface DialogHandle {
  root: HTMLElement;
  close: () => void;
}

const open = new Set<HTMLElement>();

export function anyDialogOpen(): boolean {
  return open.size > 0;
}

export function openDialog(
  name: string,
  build: (close: () => void) => Array<Node | string>,
  opener: HTMLElement | null
): DialogHandle {
  const root = el('div', { role: 'dialog', 'aria-label': name, 'aria-modal': 'true', class: 'dialog' });
  const close = (): void => {
    if (!open.has(root)) return;
    open.delete(root);
    root.remove();
    if (opener !== null && opener.isConnected) opener.focus();
  };
  for (const child of build(close)) root.append(child);
  document.body.append(root);
  open.add(root);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    trapTab(root, event);
  });
  const first = focusableIn(root)[0];
  if (first !== undefined) first.focus();
  return { root, close };
}
